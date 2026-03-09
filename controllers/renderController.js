const Render = require('../models/Render');
const cloudinary = require('cloudinary').v2;
const axios = require('axios');
const FormData = require('form-data');
const getPrompt = require('../config/prompt');

const getBedrooms = (bhk) => {
  const map = {
    '1BHK': '1 bedroom', '2BHK': '2 bedrooms',
    '3BHK': '3 bedrooms', '4BHK': '4 bedrooms',
    '5BHK': '5 bedrooms', '6BHK': '6 bedrooms',
  };
  return map[bhk] || '2 bedrooms';
};

const uploadToCloudinary = (buffer, folder) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder },
      (error, result) => {
        if (error) reject(error);
        else resolve(result.secure_url);
      }
    );
    stream.end(buffer);
  });
};

const createRender = async (req, res) => {
  try {
    const { bhk } = req.body;
    const bedrooms = getBedrooms(bhk);

    const imageUrl = await uploadToCloudinary(req.file.buffer, 'archflow/uploads');

    const formData = new FormData();
    const prompt = getPrompt(bedrooms);
    formData.append('prompt', prompt);
    formData.append('negative_prompt', 'swimming pool, garden, luxury villa, exterior, trees, sky, pool, outdoor');
    formData.append('output_format', 'png');


    const response = await axios.post(
      'https://api.stability.ai/v2beta/stable-image/generate/core',
      formData,
      {
        validateStatus: undefined,
        responseType: 'arraybuffer',
        headers: {
          ...formData.getHeaders(),
          Authorization: `Bearer ${process.env.STABILITY_API_KEY}`,
          Accept: 'image/*',
        },
      }
    );

    if (response.status !== 200) {
      throw new Error(`Stability AI error: ${response.status}`);
    }

    const generatedImageUrl = await uploadToCloudinary(response.data, 'archflow/generated');

    const render = await Render.create({
      user: req.user._id,
      imageUrl,
      generatedImageUrl,
      bhk,
      status: 'completed',
    });

    res.status(201).json(render);

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

const getRenders = async (req, res) => {
  try {
    const renders = await Render.find({ user: req.user._id });
    res.status(200).json(renders);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { createRender, getRenders };