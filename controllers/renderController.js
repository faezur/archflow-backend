const Render = require('../models/Render');
const { cloudinary } = require('../config/cloudinary');

// Render save
const createRender = async (req, res) => {
  try {
    const imageUrl = req.file.path;
    const { bhk } = req.body;

    const render = await Render.create({
      user: req.user._id,
      imageUrl,
      bhk
    });

    res.status(201).json(render);

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get user's render
const getRenders = async (req, res) => {
  try {
    const renders = await Render.find({ user: req.user._id });
    res.status(200).json(renders);

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { createRender, getRenders };