import B2 from 'backblaze-b2';
import { config } from '../config';
import { v4 as uuidv4 } from 'uuid';

class BackblazeService {
  private b2: B2;
  private isAuthorized = false;

  constructor() {
    this.b2 = new B2({
      applicationKeyId: config.backblaze.applicationKeyId,
      applicationKey: config.backblaze.applicationKey
    });
  }

  async initialize() {
    if (!this.isAuthorized) {
      try {
        await this.b2.authorize();
        this.isAuthorized = true;
        console.log('Backblaze B2 authorized successfully');
      } catch (error) {
        console.error('Failed to authorize Backblaze B2:', error);
        throw new Error('Backblaze B2 authorization failed');
      }
    }
  }

  async getUploadUrl(userId: string, originalFilename: string) {
    await this.initialize();
    
    try {
      const response = await this.b2.getUploadUrl({
        bucketId: config.backblaze.bucketId
      });

      const fileId = uuidv4();
      const fileExtension = originalFilename.split('.').pop();
      const fileName = `videos/${userId}/${fileId}.${fileExtension}`;

      return {
        uploadUrl: response.data.uploadUrl,
        authorizationToken: response.data.authorizationToken,
        fileName,
        fileId
      };
    } catch (error) {
      console.error('Failed to get upload URL:', error);
      throw new Error('Failed to get upload URL from Backblaze B2');
    }
  }

  async uploadFile(
    uploadUrl: string,
    authorizationToken: string,
    fileName: string,
    fileBuffer: Buffer,
    contentType: string
  ) {
    try {
      const response = await this.b2.uploadFile({
        uploadUrl,
        uploadAuthToken: authorizationToken,
        fileName,
        data: fileBuffer,
        mime: contentType
      });

      return {
        fileId: response.data.fileId,
        fileName: response.data.fileName,
        contentLength: response.data.contentLength,
        contentSha1: response.data.contentSha1,
        fileInfo: response.data.fileInfo
      };
    } catch (error) {
      console.error('Failed to upload file:', error);
      throw new Error('Failed to upload file to Backblaze B2');
    }
  }

  async getDownloadUrl(fileName: string) {
    await this.initialize();
    
    try {
      const response = await this.b2.getDownloadAuthorization({
        bucketId: config.backblaze.bucketId,
        fileNamePrefix: fileName,
        validDurationInSeconds: 3600 // 1 hour
      });

      const baseUrl = `https://f${config.backblaze.bucketId.slice(0, 3)}.backblazeb2.com`;
      const downloadUrl = `${baseUrl}/file/${config.backblaze.bucketName}/${fileName}?Authorization=${response.data.authorizationToken}`;

      return downloadUrl;
    } catch (error) {
      console.error('Failed to get download URL:', error);
      throw new Error('Failed to get download URL from Backblaze B2');
    }
  }

  async getPublicUrl(fileName: string) {
    const baseUrl = `https://f${config.backblaze.bucketId.slice(0, 3)}.backblazeb2.com`;
    return `${baseUrl}/file/${config.backblaze.bucketName}/${fileName}`;
  }

  async deleteFile(fileName: string, fileId: string) {
    await this.initialize();
    
    try {
      await this.b2.deleteFileVersion({
        fileId,
        fileName
      });
      
      return true;
    } catch (error) {
      console.error('Failed to delete file:', error);
      throw new Error('Failed to delete file from Backblaze B2');
    }
  }

  async listFiles(userId?: string, startFileName?: string, maxFileCount = 100) {
    await this.initialize();
    
    try {
      const prefix = userId ? `videos/${userId}/` : 'videos/';
      
      const response = await this.b2.listFileNames({
        bucketId: config.backblaze.bucketId,
        startFileName,
        maxFileCount,
        prefix
      });

      return {
        files: response.data.files,
        nextFileName: response.data.nextFileName
      };
    } catch (error) {
      console.error('Failed to list files:', error);
      throw new Error('Failed to list files from Backblaze B2');
    }
  }
}

export const backblazeService = new BackblazeService();