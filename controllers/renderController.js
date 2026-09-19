const Render = require('../models/Render');

const { cloudinary } = require('../config/cloudinary');

const axios = require('axios');

const FormData = require('form-data');

const { uploadToCloudinary } = require('../utils/cloudinaryHelper');

const { withRetry } = require('../utils/withRetry');


// ─────────────────────────────────────────────────────────────
// STEP 1: ANALYZE FLOOR PLAN WITH OPENROUTER FREE VISION
// ─────────────────────────────────────────────────────────────

const analyzeFloorPlan = async (
  fileBuffer,
  mimeType = 'image/jpeg'
) => {
  return withRetry(
    async () => {
      const base64Image = fileBuffer.toString('base64');

      const dataUrl = `data:${mimeType};base64,${base64Image}`;

      const response = await axios.post(
        'https://openrouter.ai/api/v1/chat/completions',
        {
          model: 'openrouter/free',

          messages: [
            {
              role: 'user',

              content: [
                {
                  type: 'text',
                  text: process.env.GROQ_PROMPT,
                },

                {
                  type: 'image_url',
                  image_url: {
                    url: dataUrl,
                  },
                },
              ],
            },
          ],

          max_tokens: 500,
        },
        {
          headers: {
            Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',

            'HTTP-Referer':
              'https://arch-flow-mu.vercel.app',

            'X-Title': 'ArchFlow',
          },

          timeout: 120000,
        }
      );

      console.log(
  '🔍 OPENROUTER RAW RESPONSE:',
  JSON.stringify(response.data, null, 2)
);

     const content =
  response.data?.choices?.[0]?.message?.content ||
  response.data?.choices?.[0]?.message?.reasoning;


      if (!content) {
        throw new Error(
          'OpenRouter returned an empty response'
        );
      }

      return content
        .trim()
        .replace(/\n/g, ' ')
        .replace(/;/g, ',')
        .replace(/\s+/g, ' ')
        .slice(0, 700);
    },

    3,
    3000,
    'OpenRouter'
  );
};



// ─────────────────────────────────────────────────────────────
// STEP 2: GENERATE 3D RENDER WITH STABILITY AI
// ─────────────────────────────────────────────────────────────

const generateWithStability = async (
  fileBuffer,
  prompt
) => {
  return withRetry(
    async () => {
      const formData = new FormData();

      formData.append('image', fileBuffer, {
        filename: 'floorplan.png',
        contentType: 'image/png',
      });

      formData.append('prompt', prompt);

      formData.append(
        'negative_prompt',
        '2D, flat, sketch, blueprint, text, labels, dimensions, arrows, blurry, ugly, low quality, cartoon, painting'
      );

      formData.append('output_format', 'png');

      formData.append('strength', '0.85');

      formData.append('cfg_scale', '8');

      const response = await axios.post(
        'https://api.stability.ai/v2beta/stable-image/control/structure',
        formData,
        {
          headers: {
            ...formData.getHeaders(),

            Authorization: `Bearer ${process.env.STABILITY_API_KEY}`,

            Accept: 'image/*',
          },

          responseType: 'arraybuffer',

          timeout: 120000,
        }
      );

      if (response.data.byteLength < 5000) {
        throw new Error(
          'Stability returned invalid image'
        );
      }

      return Buffer.from(response.data);
    },

    3,
    5000,
    'Stability AI'
  );
};


// ─────────────────────────────────────────────────────────────
// ROUTE 1: ANALYZE
// OpenRouter Vision + Cloudinary Upload
// ─────────────────────────────────────────────────────────────

const analyzeRender = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        message: 'No image file received',
      });
    }

    // Step 1: Upload original image to Cloudinary
    const uploadedImageUrl =
      await uploadToCloudinary(
        req.file.buffer,
        'archflow/uploads'
      );

    console.log('✅ Cloudinary upload done');

    // Step 2: Analyze floor plan with OpenRouter
    const groqPrompt = await analyzeFloorPlan(
      req.file.buffer,
      req.file.mimetype
    );

    console.log(
      '✅ OpenRouter Analysis:',
      groqPrompt
    );

    return res.status(200).json({
      uploadedImageUrl,
      groqPrompt,
    });
  } catch (error) {
    console.error(
      '❌ analyzeRender error:',
      error.response?.data || error
    );

    return res.status(500).json({
      message:
        error.response?.data?.error?.message ||
        error.message ||
        'Analysis failed. Please try again.',
    });
  }
};


// ─────────────────────────────────────────────────────────────
// ROUTE 2: GENERATE
// Stability AI + Cloudinary + MongoDB
// ─────────────────────────────────────────────────────────────

const createRender = async (req, res) => {
  try {
    const {
      uploadedImageUrl,
      groqPrompt,
    } = req.body;

    if (!uploadedImageUrl || !groqPrompt) {
      return res.status(400).json({
        message:
          'Missing uploadedImageUrl or groqPrompt',
      });
    }

    if (!req.file) {
      return res.status(400).json({
        message: 'No image file received',
      });
    }

    // Step 3: Generate 3D render with Stability AI
    console.log(
      '🎨 Calling Stability AI...'
    );

    const imageBuffer =
      await generateWithStability(
        req.file.buffer,
        groqPrompt
      );

    console.log(
      '✅ Stability image generated | Size:',
      imageBuffer.byteLength
    );

    // Step 4: Upload generated image to Cloudinary
    const generatedImageUrl =
      await uploadToCloudinary(
        imageBuffer,
        'archflow/generated'
      );

    console.log(
      '✅ Generated image on Cloudinary:',
      generatedImageUrl
    );

    // Step 5: Save render history to MongoDB
    const render = await Render.create({
      user: req.user._id,

      imageUrl: uploadedImageUrl,

      generatedImageUrl,

      groqPrompt,

      status: 'completed',
    });

    return res.status(201).json(render);
  } catch (error) {
    console.error(
      '❌ createRender error:',
      error.response?.data || error.message
    );

    const status =
      error.response?.status;

    let message =
      'Something went wrong. Please try again.';

    if (status === 429) {
      message =
        'Too many requests. Please wait a moment and try again.';
    } else if (status === 402) {
      message =
        'Service credits exhausted. Please try again later.';
    } else if (status === 401) {
      message =
        'API authentication failed. Please contact support.';
    } else if (status >= 500) {
      message =
        'AI service is temporarily unavailable. Please try again in a few seconds.';
    } else if (
      error.message
        ?.toLowerCase()
        .includes('timeout')
    ) {
      message =
        'Request timed out. Please try again.';
    }

    return res.status(500).json({
      message,
    });
  }
};


// ─────────────────────────────────────────────────────────────
// GET RENDERS
// ─────────────────────────────────────────────────────────────

const getRenders = async (req, res) => {
  try {
    const renders = await Render.find({
      user: req.user._id,
    }).sort({
      createdAt: -1,
    });

    return res.status(200).json(renders);
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};


// ─────────────────────────────────────────────────────────────
// DELETE RENDER
// ─────────────────────────────────────────────────────────────

const deleteRender = async (req, res) => {
  try {
    const render = await Render.findById(
      req.params.id
    );

    if (!render) {
      return res.status(404).json({
        message: 'Render not found',
      });
    }

    if (
      render.user.toString() !==
      req.user._id.toString()
    ) {
      return res.status(401).json({
        message: 'Not authorized',
      });
    }

    // Extract Cloudinary public ID
    const extractPublicId = (url) => {
      const parts = url.split('/');

      const uploadIndex =
        parts.indexOf('upload');

      const publicIdParts =
        parts.slice(uploadIndex + 2);

      return publicIdParts
        .join('/')
        .replace(/\.[^/.]+$/, '');
    };

    // Delete original image
    if (render.imageUrl) {
      await cloudinary.uploader.destroy(
        extractPublicId(
          render.imageUrl
        )
      );
    }

    // Delete generated image
    if (render.generatedImageUrl) {
      await cloudinary.uploader.destroy(
        extractPublicId(
          render.generatedImageUrl
        )
      );
    }

    // Delete MongoDB record
    await render.deleteOne();

    return res.status(200).json({
      message: 'Render deleted',
    });
  } catch (error) {
    return res.status(500).json({
      message: error.message,
    });
  }
};


// ─────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────

module.exports = {
  analyzeRender,
  createRender,
  getRenders,
  deleteRender,
};