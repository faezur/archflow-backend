const Render = require('../models/Render');
const { cloudinary } = require('../config/cloudinary');
const axios = require('axios');
const Groq = require('groq-sdk');
const FormData = require('form-data');

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ─── Retry Helper ─────────────────────────────────────────────────────────────
const withRetry = async (fn, retries = 3, delay = 2000, label = '') => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = err.response?.status || err.status;
      const isRateLimit = status === 429;
      const isServerError = status >= 500 && status < 600;
      const shouldRetry = isRateLimit || isServerError;

      console.warn(`⚠️ ${label} attempt ${attempt}/${retries} failed — status: ${status || 'N/A'} | ${err.message}`);

      if (attempt === retries || !shouldRetry) {
        console.error(`❌ ${label} all retries exhausted`);
        throw err;
      }

      const retryAfter = err.response?.headers?.['retry-after'];
      const waitTime = retryAfter ? parseInt(retryAfter) * 1000 : delay * attempt;
      console.log(`⏳ ${label} waiting ${waitTime / 1000}s before retry...`);
      await new Promise(r => setTimeout(r, waitTime));
    }
  }
};

// ─── Cloudinary Upload ────────────────────────────────────────────────────────
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

// ─── Groq: Floor Plan Analysis — base64 image directly ───────────────────────
// Cloudinary URL Groq ke servers pe 403 deta hai
// Solution: buffer ko base64 mein convert karke directly bhejo
const analyzeFloorPlan = async (fileBuffer, mimeType = 'image/jpeg') => {
  return withRetry(async () => {
    const base64Image = fileBuffer.toString('base64')
    const dataUrl = `data:${mimeType};base64,${base64Image}`

    const response = await groq.chat.completions.create({
      model: 'meta-llama/llama-4-scout-17b-16e-instruct',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: { url: dataUrl }   // ← base64 data URL, not Cloudinary URL
            },
            {
              type: 'text',
              text: process.env.GROQ_PROMPT
            }
          ]
        }
      ],
      max_tokens: 500,
    });

    return response.choices[0].message.content
      .trim()
      .replace(/\n/g, ' ')
      .replace(/;/g, ',')
      .replace(/\s+/g, ' ')
      .slice(0, 700);

  }, 3, 3000, 'Groq');
};

// ─── Stability AI: Image Generation ──────────────────────────────────────────
const generateWithStability = async (fileBuffer, prompt) => {
  return withRetry(async () => {
    const formData = new FormData();
    formData.append('image', fileBuffer, {
      filename: 'floorplan.png',
      contentType: 'image/png',
    });
    formData.append('prompt', prompt);
    formData.append('negative_prompt', '2D, flat, sketch, blueprint, text, labels, dimensions, arrows, blurry, ugly, low quality, cartoon, painting');
    formData.append('output_format', 'png');
    formData.append('strength', '0.85');
    formData.append('cfg_scale', '7');

    const response = await axios.post(
      'https://api.stability.ai/v2beta/stable-image/control/structure',
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          'Authorization': `Bearer ${process.env.STABILITY_API_KEY}`,
          'Accept': 'image/*',
        },
        responseType: 'arraybuffer',
        timeout: 120000,
      }
    );

    if (response.data.byteLength < 5000) {
      throw new Error('Stability returned invalid image');
    }

    return Buffer.from(response.data);
  }, 3, 5000, 'Stability AI');
};

// ─── ROUTE 1: Analyze — Groq prompt only (fast ~2-3s) ────────────────────────
const analyzeRender = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ message: 'No image file received' })
    }

    // Step 1: Upload to Cloudinary (for storing original)
    const uploadedImageUrl = await uploadToCloudinary(req.file.buffer, 'archflow/uploads')
    console.log('✅ Cloudinary upload done')

    // Step 2: Groq — base64 image directly (bypasses Cloudinary 403)
    const groqPrompt = await analyzeFloorPlan(req.file.buffer, req.file.mimetype)
    console.log('✅ Groq Prompt:', groqPrompt)

    res.status(200).json({ uploadedImageUrl, groqPrompt })

  } catch (error) {
    console.error('❌ analyzeRender error:', error)
    res.status(500).json({ message: error.message || 'Analysis failed. Please try again.' })
  }
}

// ─── ROUTE 2: Generate — Stability image (slow ~15-30s) ──────────────────────
const createRender = async (req, res) => {
  try {
    const { uploadedImageUrl, groqPrompt } = req.body;

    if (!uploadedImageUrl || !groqPrompt) {
      return res.status(400).json({ message: 'Missing uploadedImageUrl or groqPrompt' });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'No image file received' });
    }

    // Step 3: Stability AI — generate 3D render
    console.log('🎨 Calling Stability AI...');
    const imageBuffer = await generateWithStability(req.file.buffer, groqPrompt);
    console.log('✅ Stability image generated | Size:', imageBuffer.byteLength);

    // Step 4: Upload generated image to Cloudinary
    const generatedImageUrl = await uploadToCloudinary(imageBuffer, 'archflow/generated');
    console.log('✅ Generated image on Cloudinary:', generatedImageUrl);

    // Step 5: Save to MongoDB
    const render = await Render.create({
      user: req.user._id,
      imageUrl: uploadedImageUrl,
      generatedImageUrl,
      groqPrompt,
      status: 'completed',
    });

    res.status(201).json(render);

  } catch (error) {
    console.error('❌ createRender error:', error.message);

    const status = error.response?.status;
    let message = 'Something went wrong. Please try again.';

    if (status === 429)      message = 'Too many requests. Please wait a moment and try again.';
    else if (status === 402) message = 'Service credits exhausted. Please try again later.';
    else if (status === 401) message = 'API authentication failed. Please contact support.';
    else if (status >= 500)  message = 'AI service is temporarily unavailable. Please try again in a few seconds.';
    else if (error.message?.includes('timeout')) message = 'Request timed out. Please try again.';

    res.status(500).json({ message });
  }
};

// ─── Get Renders ──────────────────────────────────────────────────────────────
const getRenders = async (req, res) => {
  try {
    const renders = await Render.find({ user: req.user._id }).sort({ createdAt: -1 });
    res.status(200).json(renders);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ─── Delete Render ────────────────────────────────────────────────────────────
const deleteRender = async (req, res) => {
  try {
    const render = await Render.findById(req.params.id);
    if (!render) return res.status(404).json({ message: 'Render not found' });
    if (render.user.toString() !== req.user._id.toString()) {
      return res.status(401).json({ message: 'Not authorized' });
    }

    const extractPublicId = (url) => {
      const parts = url.split('/');
      const file = parts[parts.length - 1].split('.')[0];
      const folder = parts[parts.length - 2];
      return `${folder}/${file}`;
    };

    if (render.imageUrl) await cloudinary.uploader.destroy(extractPublicId(render.imageUrl));
    if (render.generatedImageUrl) await cloudinary.uploader.destroy(extractPublicId(render.generatedImageUrl));

    await render.deleteOne();
    res.status(200).json({ message: 'Render deleted' });

  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { analyzeRender, createRender, getRenders, deleteRender };