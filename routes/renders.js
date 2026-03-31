const express = require('express');
const router = express.Router();
const multer = require('multer');
const { protect } = require('../middleware/authMiddleware');
const { analyzeRender, createRender, getRenders, deleteRender } = require('../controllers/renderController');

const upload = multer({ storage: multer.memoryStorage() });

// Analyze — Groq prompt only (fast)
router.post('/analyze', protect, upload.single('image'), analyzeRender);

// Generate — Stability AI image (slow)
router.post('/', protect, upload.single('image'), createRender);

// Get all renders
router.get('/', protect, getRenders);

// Delete render
router.delete('/:id', protect, deleteRender);

module.exports = router;