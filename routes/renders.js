const express = require('express');
const router = express.Router();
const { createRender, getRenders } = require('../controllers/renderController');
const { protect } = require('../middleware/authMiddleware');
const cloudinaryConfig = require('../config/cloudinary');
const upload = cloudinaryConfig.upload;

router.post('/', protect, upload.single('image'), createRender);
router.get('/', protect, getRenders);

module.exports = router;