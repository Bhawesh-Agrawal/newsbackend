import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import multer from 'multer';

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});


const articleCoverStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder:         'news-platform/covers',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [
      { width: 1200, height: 630, crop: 'fill', quality: 'auto', fetch_format: 'auto' }
    ],
  },
});

const avatarStorage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder:         'news-platform/avatars',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [
      { width: 400, height: 400, crop: 'fill', gravity: 'face', quality: 'auto' }
    ],
  },
});


const fileSizeLimit = 5 * 1024 * 1024; // 5MB

export const uploadArticleCover = multer({
  storage: articleCoverStorage,
  limits:  { fileSize: fileSizeLimit },
}).single('cover_image');

export const uploadAvatar = multer({
  storage: avatarStorage,
  limits:  { fileSize: fileSizeLimit },
}).single('avatar');

export const deleteImage = async (publicId) => {
  try {
    await cloudinary.uploader.destroy(publicId);
  } catch (err) {
    console.error('[Cloudinary] Delete failed:', err.message);
  }
};

export default cloudinary;