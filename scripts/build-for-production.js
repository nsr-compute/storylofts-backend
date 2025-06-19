#!/usr/bin/env node

/**
 * Build script for Digital Ocean deployment
 * This script handles the production build process and ensures all dependencies are available
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

console.log('🚀 Starting Digital Ocean production build...');

// Ensure we're in the right directory
const projectRoot = path.resolve(__dirname, '..');
process.chdir(projectRoot);

// Set environment for build
process.env.NODE_ENV = 'production';

try {
  // Clean previous build
  console.log('🧹 Cleaning previous build...');
  if (fs.existsSync(path.join(projectRoot, 'dist'))) {
    fs.rmSync(path.join(projectRoot, 'dist'), { recursive: true, force: true });
  }

  // Install dependencies (including devDependencies for build)
  console.log('📦 Installing dependencies...');
  execSync('npm ci --include=dev', { stdio: 'inherit' });

  // Run TypeScript compilation
  console.log('🔨 Compiling TypeScript...');
  execSync('npx tsc', { stdio: 'inherit' });

  // Verify build output
  console.log('✅ Verifying build output...');
  if (!fs.existsSync(path.join(projectRoot, 'dist', 'server.js'))) {
    throw new Error('Build failed: dist/server.js not found');
  }

  console.log('🎉 Build completed successfully!');
  console.log('📁 Build output:', path.join(projectRoot, 'dist'));

} catch (error) {
  console.error('❌ Build failed:', error.message);
  process.exit(1);
} 