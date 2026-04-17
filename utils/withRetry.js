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

module.exports = { withRetry };