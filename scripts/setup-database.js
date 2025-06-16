#!/usr/bin/env node
/**
 * StoryLofts Database Setup Script
 * Creates the complete PostgreSQL schema for the ContentHive API
 * 
 * Usage: npm run db:setup
 * Environment: Requires DATABASE_URL environment variable
 */

const { Pool } = require('pg');
const path = require('path');
require('dotenv').config();

// ANSI color codes for better console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

const log = {
  info: (msg) => console.log(`${colors.blue}ℹ${colors.reset} ${msg}`),
  success: (msg) => console.log(`${colors.green}✅${colors.reset} ${msg}`),
  warn: (msg) => console.log(`${colors.yellow}⚠${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}❌${colors.reset} ${msg}`),
  header: (msg) => console.log(`${colors.cyan}${colors.bright}🚀 ${msg}${colors.reset}`),
  step: (msg) => console.log(`${colors.magenta}📋${colors.reset} ${msg}`)
};

// Database connection configuration
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Complete StoryLofts database schema
const STORYLOFTS_SCHEMA = `
-- ================================================
-- StoryLofts ContentHive Database Schema
-- Professional video platform for content creators
-- ================================================

-- Enable required PostgreSQL extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- For fuzzy text search

-- ================================================
-- CORE TABLES
-- ================================================

-- Video content table (main entity)
CREATE TABLE IF NOT EXISTS video_content (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id VARCHAR(255) NOT NULL,
    title VARCHAR(500) NOT NULL,
    description TEXT,
    filename VARCHAR(500) NOT NULL,
    original_filename VARCHAR(500),
    file_size BIGINT NOT NULL CHECK (file_size > 0),
    duration INTEGER CHECK (duration >= 0), -- in seconds
    video_url TEXT NOT NULL,
    thumbnail_url TEXT,
    status VARCHAR(20) NOT NULL DEFAULT 'uploading' 
        CHECK (status IN ('uploading', 'processing', 'ready', 'failed')),
    visibility VARCHAR(20) NOT NULL DEFAULT 'private' 
        CHECK (visibility IN ('public', 'private', 'unlisted')),
    mime_type VARCHAR(100),
    resolution VARCHAR(20), -- e.g., "1920x1080"
    fps INTEGER CHECK (fps > 0 AND fps <= 120),
    bitrate INTEGER CHECK (bitrate > 0), -- in kbps
    codec VARCHAR(50),
    upload_session_id UUID,
    processing_started_at TIMESTAMP WITH TIME ZONE,
    processing_completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Tags for content categorization
CREATE TABLE IF NOT EXISTS tags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) UNIQUE NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    color VARCHAR(7) DEFAULT '#6b7280' CHECK (color ~ '^#[0-9A-Fa-f]{6}$'),
    description TEXT,
    usage_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Many-to-many relationship: videos <-> tags
CREATE TABLE IF NOT EXISTS video_tags (
    video_id UUID REFERENCES video_content(id) ON DELETE CASCADE,
    tag_id UUID REFERENCES tags(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (video_id, tag_id)
);

-- Collections/Playlists for organizing content
CREATE TABLE IF NOT EXISTS collections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    visibility VARCHAR(20) NOT NULL DEFAULT 'private' 
        CHECK (visibility IN ('public', 'private', 'unlisted')),
    thumbnail_url TEXT,
    video_count INTEGER DEFAULT 0 CHECK (video_count >= 0),
    total_duration INTEGER DEFAULT 0 CHECK (total_duration >= 0), -- in seconds
    sort_order VARCHAR(20) DEFAULT 'manual' 
        CHECK (sort_order IN ('manual', 'newest', 'oldest', 'alphabetical')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Many-to-many relationship: collections <-> videos
CREATE TABLE IF NOT EXISTS collection_videos (
    collection_id UUID REFERENCES collections(id) ON DELETE CASCADE,
    video_id UUID REFERENCES video_content(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position > 0),
    added_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (collection_id, video_id)
);

-- Upload sessions for tracking file uploads
CREATE TABLE IF NOT EXISTS upload_sessions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id VARCHAR(255) NOT NULL,
    filename VARCHAR(500) NOT NULL,
    file_size BIGINT CHECK (file_size > 0),
    mime_type VARCHAR(100),
    b2_upload_id VARCHAR(255), -- Backblaze B2 upload ID
    b2_file_id VARCHAR(255),   -- Backblaze B2 file ID after completion
    status VARCHAR(20) NOT NULL DEFAULT 'initiated' 
        CHECK (status IN ('initiated', 'uploading', 'completed', 'failed', 'cancelled')),
    progress_percentage INTEGER DEFAULT 0 CHECK (progress_percentage >= 0 AND progress_percentage <= 100),
    error_message TEXT,
    expires_at TIMESTAMP WITH TIME ZONE,
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ================================================
-- ANALYTICS & TRACKING TABLES
-- ================================================

-- Video view tracking for analytics
CREATE TABLE IF NOT EXISTS video_views (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    video_id UUID REFERENCES video_content(id) ON DELETE CASCADE,
    viewer_user_id VARCHAR(255), -- Auth0 user ID, nullable for anonymous views
    ip_address INET,
    user_agent TEXT,
    watch_duration INTEGER CHECK (watch_duration >= 0), -- seconds watched
    watch_percentage DECIMAL(5,2) CHECK (watch_percentage >= 0 AND watch_percentage <= 100),
    referrer TEXT,
    device_type VARCHAR(50),
    browser VARCHAR(100),
    os VARCHAR(100),
    country VARCHAR(2), -- ISO country code
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- User storage quota tracking
CREATE TABLE IF NOT EXISTS user_storage (
    user_id VARCHAR(255) PRIMARY KEY,
    storage_used_bytes BIGINT DEFAULT 0 CHECK (storage_used_bytes >= 0),
    storage_limit_bytes BIGINT DEFAULT 5368709120 CHECK (storage_limit_bytes > 0), -- 5GB default
    file_count INTEGER DEFAULT 0 CHECK (file_count >= 0),
    last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- ================================================
-- PERFORMANCE INDEXES
-- ================================================

-- Video content indexes
CREATE INDEX IF NOT EXISTS idx_video_content_user_id ON video_content(user_id);
CREATE INDEX IF NOT EXISTS idx_video_content_status ON video_content(status);
CREATE INDEX IF NOT EXISTS idx_video_content_visibility ON video_content(visibility);
CREATE INDEX IF NOT EXISTS idx_video_content_created_at ON video_content(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_video_content_updated_at ON video_content(updated_at DESC);

-- Full-text search index for video content
CREATE INDEX IF NOT EXISTS idx_video_content_search ON video_content 
    USING gin(to_tsvector('english', title || ' ' || COALESCE(description, '')));

-- Collections indexes
CREATE INDEX IF NOT EXISTS idx_collections_user_id ON collections(user_id);
CREATE INDEX IF NOT EXISTS idx_collections_visibility ON collections(visibility);
CREATE INDEX IF NOT EXISTS idx_collections_created_at ON collections(created_at DESC);

-- Upload sessions indexes
CREATE INDEX IF NOT EXISTS idx_upload_sessions_user_id ON upload_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_upload_sessions_status ON upload_sessions(status);
CREATE INDEX IF NOT EXISTS idx_upload_sessions_created_at ON upload_sessions(created_at DESC);

-- Analytics indexes
CREATE INDEX IF NOT EXISTS idx_video_views_video_id ON video_views(video_id);
CREATE INDEX IF NOT EXISTS idx_video_views_viewer_user_id ON video_views(viewer_user_id);
CREATE INDEX IF NOT EXISTS idx_video_views_created_at ON video_views(created_at DESC);

-- Tag indexes
CREATE INDEX IF NOT EXISTS idx_tags_slug ON tags(slug);
CREATE INDEX IF NOT EXISTS idx_tags_usage_count ON tags(usage_count DESC);

-- Junction table indexes
CREATE INDEX IF NOT EXISTS idx_video_tags_video_id ON video_tags(video_id);
CREATE INDEX IF NOT EXISTS idx_video_tags_tag_id ON video_tags(tag_id);

-- ================================================
-- TRIGGERS AND FUNCTIONS
-- ================================================

-- Function to update updated_at timestamp automatically
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for automatic timestamp updates
DROP TRIGGER IF EXISTS update_video_content_updated_at ON video_content;
CREATE TRIGGER update_video_content_updated_at 
    BEFORE UPDATE ON video_content 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_collections_updated_at ON collections;
CREATE TRIGGER update_collections_updated_at 
    BEFORE UPDATE ON collections 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_upload_sessions_updated_at ON upload_sessions;
CREATE TRIGGER update_upload_sessions_updated_at 
    BEFORE UPDATE ON upload_sessions 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to automatically update collection statistics
CREATE OR REPLACE FUNCTION update_collection_stats()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
        UPDATE collections 
        SET 
            video_count = (
                SELECT COUNT(*) 
                FROM collection_videos 
                WHERE collection_id = NEW.collection_id
            ),
            total_duration = (
                SELECT COALESCE(SUM(vc.duration), 0)
                FROM collection_videos cv
                JOIN video_content vc ON cv.video_id = vc.id
                WHERE cv.collection_id = NEW.collection_id
            ),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = NEW.collection_id;
    END IF;
    
    IF TG_OP = 'DELETE' THEN
        UPDATE collections 
        SET 
            video_count = (
                SELECT COUNT(*) 
                FROM collection_videos 
                WHERE collection_id = OLD.collection_id
            ),
            total_duration = (
                SELECT COALESCE(SUM(vc.duration), 0)
                FROM collection_videos cv
                JOIN video_content vc ON cv.video_id = vc.id
                WHERE cv.collection_id = OLD.collection_id
            ),
            updated_at = CURRENT_TIMESTAMP
        WHERE id = OLD.collection_id;
    END IF;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ language 'plpgsql';

-- Trigger to update collection stats automatically
DROP TRIGGER IF EXISTS update_collection_stats_trigger ON collection_videos;
CREATE TRIGGER update_collection_stats_trigger 
    AFTER INSERT OR UPDATE OR DELETE ON collection_videos 
    FOR EACH ROW EXECUTE FUNCTION update_collection_stats();

-- Function to update tag usage count
CREATE OR REPLACE FUNCTION update_tag_usage_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE tags 
        SET usage_count = usage_count + 1 
        WHERE id = NEW.tag_id;
    END IF;
    
    IF TG_OP = 'DELETE' THEN
        UPDATE tags 
        SET usage_count = GREATEST(usage_count - 1, 0)
        WHERE id = OLD.tag_id;
    END IF;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ language 'plpgsql';

-- Trigger to update tag usage count
DROP TRIGGER IF EXISTS update_tag_usage_count_trigger ON video_tags;
CREATE TRIGGER update_tag_usage_count_trigger 
    AFTER INSERT OR DELETE ON video_tags 
    FOR EACH ROW EXECUTE FUNCTION update_tag_usage_count();

-- Function to update user storage statistics
CREATE OR REPLACE FUNCTION update_user_storage_stats()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        INSERT INTO user_storage (user_id, storage_used_bytes, file_count, last_updated)
        VALUES (NEW.user_id, NEW.file_size, 1, CURRENT_TIMESTAMP)
        ON CONFLICT (user_id) 
        DO UPDATE SET 
            storage_used_bytes = user_storage.storage_used_bytes + NEW.file_size,
            file_count = user_storage.file_count + 1,
            last_updated = CURRENT_TIMESTAMP;
    END IF;
    
    IF TG_OP = 'DELETE' THEN
        UPDATE user_storage 
        SET 
            storage_used_bytes = GREATEST(storage_used_bytes - OLD.file_size, 0),
            file_count = GREATEST(file_count - 1, 0),
            last_updated = CURRENT_TIMESTAMP
        WHERE user_id = OLD.user_id;
    END IF;
    
    IF TG_OP = 'UPDATE' AND NEW.file_size != OLD.file_size THEN
        UPDATE user_storage 
        SET 
            storage_used_bytes = storage_used_bytes - OLD.file_size + NEW.file_size,
            last_updated = CURRENT_TIMESTAMP
        WHERE user_id = NEW.user_id;
    END IF;
    
    RETURN COALESCE(NEW, OLD);
END;
$$ language 'plpgsql';

-- Trigger to update user storage stats
DROP TRIGGER IF EXISTS update_user_storage_stats_trigger ON video_content;
CREATE TRIGGER update_user_storage_stats_trigger 
    AFTER INSERT OR UPDATE OR DELETE ON video_content 
    FOR EACH ROW EXECUTE FUNCTION update_user_storage_stats();
`;

// Professional content tags for StoryLofts platform
const INITIAL_DATA = `
-- ================================================
-- INITIAL DATA FOR STORYLOFTS PLATFORM
-- ================================================

-- Professional content tags
INSERT INTO tags (name, slug, color, description) VALUES 
    ('Business', 'business', '#2563eb', 'Business presentations and corporate content'),
    ('Tutorial', 'tutorial', '#059669', 'Educational and how-to content'),
    ('Marketing', 'marketing', '#dc2626', 'Marketing materials and promotional content'),
    ('Product Demo', 'product-demo', '#7c3aed', 'Product demonstrations and features'),
    ('Conference', 'conference', '#ea580c', 'Conference talks and presentations'),
    ('Training', 'training', '#0891b2', 'Training materials and workshops'),
    ('Presentation', 'presentation', '#ca8a04', 'General presentations and talks'),
    ('Interview', 'interview', '#059669', 'Interviews and conversations'),
    ('Webinar', 'webinar', '#7c2d12', 'Webinars and online seminars'),
    ('Case Study', 'case-study', '#065f46', 'Case studies and success stories'),
    ('Workshop', 'workshop', '#7e22ce', 'Interactive workshops and sessions'),
    ('Announcement', 'announcement', '#be123c', 'Company announcements and updates')
ON CONFLICT (slug) DO NOTHING;

-- Update usage counts to 0 for all tags
UPDATE tags SET usage_count = 0 WHERE usage_count IS NULL;
`;

/**
 * Validate environment configuration
 */
function validateEnvironment() {
    log.step('Validating environment configuration...');
    
    if (!process.env.DATABASE_URL) {
        log.error('DATABASE_URL environment variable is not set');
        log.info('Please set DATABASE_URL with your PostgreSQL connection string');
        process.exit(1);
    }
    
    log.success('Environment configuration validated');
}

/**
 * Test database connection
 */
async function testConnection() {
    log.step('Testing database connection...');
    
    try {
        const client = await pool.connect();
        await client.query('SELECT version()');
        
        const result = await client.query('SELECT version()');
        const version = result.rows[0].version;
        
        client.release();
        log.success('Database connection successful');
        log.info(`PostgreSQL version: ${version.split(' ')[1]}`);
        
        return true;
    } catch (error) {
        log.error(`Database connection failed: ${error.message}`);
        return false;
    }
}

/**
 * Create database schema
 */
async function createSchema() {
    log.step('Creating StoryLofts database schema...');
    
    try {
        const client = await pool.connect();
        
        // Execute schema creation
        await client.query(STORYLOFTS_SCHEMA);
        log.success('Database schema created successfully');
        
        client.release();
        return true;
    } catch (error) {
        log.error(`Schema creation failed: ${error.message}`);
        return false;
    }
}

/**
 * Insert initial data
 */
async function insertInitialData() {
    log.step('Inserting initial data...');
    
    try {
        const client = await pool.connect();
        
        // Insert initial tags
        await client.query(INITIAL_DATA);
        
        // Get count of inserted tags
        const result = await client.query('SELECT COUNT(*) FROM tags');
        const tagCount = result.rows[0].count;
        
        client.release();
        log.success(`Initial data inserted successfully`);
        log.info(`Professional tags created: ${tagCount}`);
        
        return true;
    } catch (error) {
        log.error(`Initial data insertion failed: ${error.message}`);
        return false;
    }
}

/**
 * Verify database setup
 */
async function verifySetup() {
    log.step('Verifying database setup...');
    
    try {
        const client = await pool.connect();
        
        // Check tables
        const tablesResult = await client.query(`
            SELECT table_name, table_type
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            ORDER BY table_name
        `);
        
        log.info('Created tables:');
        tablesResult.rows.forEach(row => {
            log.info(`  ✓ ${row.table_name}`);
        });
        
        // Check indexes
        const indexesResult = await client.query(`
            SELECT indexname 
            FROM pg_indexes 
            WHERE schemaname = 'public' 
            AND indexname LIKE 'idx_%'
            ORDER BY indexname
        `);
        
        log.info(`Performance indexes created: ${indexesResult.rows.length}`);
        
        // Check functions
        const functionsResult = await client.query(`
            SELECT routine_name 
            FROM information_schema.routines 
            WHERE routine_schema = 'public'
            ORDER BY routine_name
        `);
        
        log.info(`Database functions created: ${functionsResult.rows.length}`);
        
        // Check triggers
        const triggersResult = await client.query(`
            SELECT trigger_name 
            FROM information_schema.triggers 
            WHERE trigger_schema = 'public'
            ORDER BY trigger_name
        `);
        
        log.info(`Database triggers created: ${triggersResult.rows.length}`);
        
        client.release();
        log.success('Database setup verification completed');
        
        return true;
    } catch (error) {
        log.error(`Setup verification failed: ${error.message}`);
        return false;
    }
}

/**
 * Display next steps
 */
function displayNextSteps() {
    log.header('StoryLofts Database Setup Complete! 🎉');
    console.log('');
    log.info('Next steps:');
    log.info('1. Deploy your application with the updated code');
    log.info('2. Test API endpoints: https://api.storylofts.com/health/detailed');
    log.info('3. Verify database health: https://api.storylofts.com/health/database');
    log.info('4. Test content endpoints: https://api.storylofts.com/api/content');
    console.log('');
    log.success('Your StoryLofts ContentHive backend is now ready for production! 🚀');
}

/**
 * Main setup function
 */
async function setupDatabase() {
    try {
        log.header('StoryLofts ContentHive Database Setup');
        console.log('');
        
        // Validate environment
        validateEnvironment();
        
        // Test connection
        const connectionOk = await testConnection();
        if (!connectionOk) {
            process.exit(1);
        }
        
        // Create schema
        const schemaOk = await createSchema();
        if (!schemaOk) {
            process.exit(1);
        }
        
        // Insert initial data
        const dataOk = await insertInitialData();
        if (!dataOk) {
            process.exit(1);
        }
        
        // Verify setup
        const verifyOk = await verifySetup();
        if (!verifyOk) {
            process.exit(1);
        }
        
        // Display next steps
        displayNextSteps();
        
    } catch (error) {
        log.error(`Setup failed: ${error.message}`);
        console.error(error.stack);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
    log.warn('Setup interrupted by user');
    await pool.end();
    process.exit(1);
});

process.on('SIGTERM', async () => {
    log.warn('Setup terminated');
    await pool.end();
    process.exit(1);
});

// Run setup if called directly
if (require.main === module) {
    setupDatabase();
}

module.exports = { setupDatabase };
