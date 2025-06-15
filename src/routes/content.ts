import { Router } from 'express';
import { query, param, body, validationResult } from 'express-validator';
import { requireAuth, optionalAuth } from '../middleware/auth';
import { AuthenticatedRequest, ApiResponse, VideoContent, PaginatedResponse, VideoVisibility } from '../types';
import { videoStorage } from './upload'; // Import the video storage

const router = Router();

/**
 * GET /api/content
 * Get paginated list of videos (public videos for unauthenticated, user's videos for authenticated)
 */
router.get('/',
  optionalAuth,
  [
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
    query('search').optional().isString().withMessage('Search must be a string'),
    query('tags').optional().isString().withMessage('Tags must be a comma-separated string'),
    query('visibility').optional().isIn(['public', 'private', 'unlisted']).withMessage('Invalid visibility')
  ],
  async (req: AuthenticatedRequest, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          data: errors.array()
        } as ApiResponse);
      }

      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;
      const search = req.query.search as string;
      const tagFilter = req.query.tags as string;
      const visibilityFilter = req.query.visibility as VideoVisibility;
      const userId = req.user?.sub;

      // Convert Map to Array for filtering
      let videos = Array.from(videoStorage.values());

      // Filter by user access
      if (userId) {
        // Authenticated user: show their videos + public videos
        videos = videos.filter(video => 
          video.userId === userId || video.visibility === VideoVisibility.PUBLIC
        );
      } else {
        // Unauthenticated: only public videos
        videos = videos.filter(video => video.visibility === VideoVisibility.PUBLIC);
      }

      // Apply filters
      if (search) {
        const searchLower = search.toLowerCase();
        videos = videos.filter(video =>
          video.title.toLowerCase().includes(searchLower) ||
          video.description?.toLowerCase().includes(searchLower)
        );
      }

      if (tagFilter) {
        const tags = tagFilter.split(',').map(tag => tag.trim().toLowerCase());
        videos = videos.filter(video =>
          tags.some(tag => video.tags.some(videoTag => videoTag.toLowerCase().includes(tag)))
        );
      }

      if (visibilityFilter && userId) {
        videos = videos.filter(video => 
          video.visibility === visibilityFilter && video.userId === userId
        );
      }

      // Sort by creation date (newest first)
      videos.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      // Pagination
      const total = videos.length;
      const totalPages = Math.ceil(total / limit);
      const startIndex = (page - 1) * limit;
      const endIndex = startIndex + limit;
      const paginatedVideos = videos.slice(startIndex, endIndex);

      const response: PaginatedResponse<VideoContent> = {
        data: paginatedVideos,
        pagination: {
          page,
          limit,
          total,
          totalPages
        }
      };

      res.json({
        success: true,
        data: response
      } as ApiResponse<PaginatedResponse<VideoContent>>);

    } catch (error) {
      console.error('Content listing failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve content'
      } as ApiResponse);
    }
  }
);

/**
 * GET /api/content/:id
 * Get specific video by ID
 */
router.get('/:id',
  optionalAuth,
  [
    param('id').isUUID().withMessage('Invalid video ID')
  ],
  async (req: AuthenticatedRequest, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          data: errors.array()
        } as ApiResponse);
      }

      const { id } = req.params;
      const userId = req.user?.sub;
      const video = videoStorage.get(id);

      if (!video) {
        return res.status(404).json({
          success: false,
          error: 'Video not found'
        } as ApiResponse);
      }

      // Check access permissions
      const canAccess = 
        video.visibility === VideoVisibility.PUBLIC ||
        (userId && video.userId === userId) ||
        video.visibility === VideoVisibility.UNLISTED;

      if (!canAccess) {
        return res.status(403).json({
          success: false,
          error: 'Access denied'
        } as ApiResponse);
      }

      res.json({
        success: true,
        data: video
      } as ApiResponse<VideoContent>);

    } catch (error) {
      console.error('Video retrieval failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve video'
      } as ApiResponse);
    }
  }
);

/**
 * PUT /api/content/:id
 * Update video metadata
 */
router.put('/:id',
  requireAuth,
  [
    param('id').isUUID().withMessage('Invalid video ID'),
    body('title').optional().isLength({ min: 1, max: 255 }).withMessage('Title must be between 1 and 255 characters'),
    body('description').optional().isLength({ max: 1000 }).withMessage('Description must be less than 1000 characters'),
    body('visibility').optional().isIn(['public', 'private', 'unlisted']).withMessage('Invalid visibility setting'),
    body('tags').optional().isArray().withMessage('Tags must be an array')
  ],
  async (req: AuthenticatedRequest, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          data: errors.array()
        } as ApiResponse);
      }

      const { id } = req.params;
      const userId = req.user!.sub;
      const video = videoStorage.get(id);

      if (!video) {
        return res.status(404).json({
          success: false,
          error: 'Video not found'
        } as ApiResponse);
      }

      if (video.userId !== userId) {
        return res.status(403).json({
          success: false,
          error: 'Access denied'
        } as ApiResponse);
      }

      // Update video metadata
      const { title, description, visibility, tags } = req.body;
      const updatedVideo: VideoContent = {
        ...video,
        ...(title && { title }),
        ...(description !== undefined && { description }),
        ...(visibility && { visibility: visibility as VideoVisibility }),
        ...(tags && { tags }),
        updatedAt: new Date()
      };

      videoStorage.set(id, updatedVideo);

      res.json({
        success: true,
        data: updatedVideo
      } as ApiResponse<VideoContent>);

    } catch (error) {
      console.error('Video update failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to update video'
      } as ApiResponse);
    }
  }
);

/**
 * DELETE /api/content/:id
 * Delete video
 */
router.delete('/:id',
  requireAuth,
  [
    param('id').isUUID().withMessage('Invalid video ID')
  ],
  async (req: AuthenticatedRequest, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          data: errors.array()
        } as ApiResponse);
      }

      const { id } = req.params;
      const userId = req.user!.sub;
      const video = videoStorage.get(id);

      if (!video) {
        return res.status(404).json({
          success: false,
          error: 'Video not found'
        } as ApiResponse);
      }

      if (video.userId !== userId) {
        return res.status(403).json({
          success: false,
          error: 'Access denied'
        } as ApiResponse);
      }

      // TODO: In production, implement proper file deletion
      // For now, we'll just remove from storage
      videoStorage.delete(id);

      res.json({
        success: true,
        message: 'Video deleted successfully'
      } as ApiResponse);

    } catch (error) {
      console.error('Video deletion failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to delete video'
      } as ApiResponse);
    }
  }
);

/**
 * GET /api/content/user/:userId
 * Get videos by user ID (public videos only unless requesting own profile)
 */
router.get('/user/:userId',
  optionalAuth,
  [
    param('userId').isString().withMessage('Invalid user ID'),
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100')
  ],
  async (req: AuthenticatedRequest, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          data: errors.array()
        } as ApiResponse);
      }

      const { userId: targetUserId } = req.params;
      const currentUserId = req.user?.sub;
      const page = parseInt(req.query.page as string) || 1;
      const limit = parseInt(req.query.limit as string) || 20;

      let videos = Array.from(videoStorage.values())
        .filter(video => video.userId === targetUserId);

      // If not viewing own profile, only show public videos
      if (currentUserId !== targetUserId) {
        videos = videos.filter(video => video.visibility === VideoVisibility.PUBLIC);
      }

      // Sort by creation date (newest first)
      videos.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

      // Pagination
      const total = videos.length;
      const totalPages = Math.ceil(total / limit);
      const startIndex = (page - 1) * limit;
      const endIndex = startIndex + limit;
      const paginatedVideos = videos.slice(startIndex, endIndex);

      const response: PaginatedResponse<VideoContent> = {
        data: paginatedVideos,
        pagination: {
          page,
          limit,
          total,
          totalPages
        }
      };

      res.json({
        success: true,
        data: response
      } as ApiResponse<PaginatedResponse<VideoContent>>);

    } catch (error) {
      console.error('User content retrieval failed:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve user content'
      } as ApiResponse);
    }
  }
);

export { router as contentRouter };