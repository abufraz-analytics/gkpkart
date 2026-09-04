const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

// .env se credentials load karna
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

// Multer storage engine configure karna Cloudinary ke liye
const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'GkpKart_Products', // Cloudinary par is naam ka folder ban jayega
        allowed_formats: ['jpeg', 'png', 'jpg', 'webp']
    }
});

const upload = multer({ storage: storage });

module.exports = { cloudinary, upload };