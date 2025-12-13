# Available Gemini Models

## Model Options for Vendor-Supplier Matching

Based on your use case, here are the recommended models:

### Recommended Models (in order of preference):

1. **`gemini-2.5-flash`** ⭐ (Currently Set)
   - Fast and balanced intelligence
   - Good for real-time matching tasks
   - Optimized for speed and accuracy

2. **`gemini-2.0-flash`**
   - Multimodal, general-purpose
   - Cost-effective for wide range of tasks
   - Good balance of performance and cost

3. **`gemini-2.5-flash-lite`**
   - Efficient and cost-effective
   - Optimized for high-frequency tasks
   - Best for batch processing

4. **`gemini-1.5-flash`** (Fallback)
   - Free tier compatible
   - Reliable fallback option
   - Works if newer models hit quota limits

### Advanced Models (for complex scenarios):

5. **`gemini-2.5-pro`**
   - Excels at complex tasks
   - 1 million token context window
   - Best for very large datasets

6. **`gemini-3-pro-preview`**
   - Most intelligent model
   - Complex reasoning capabilities
   - Multimodal understanding

## How to Change the Model

Edit `api/index.js` line ~565:

```javascript
const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });
```

Change `'gemini-2.5-flash'` to any of the models above.

## Free Tier Availability

- ✅ **Available**: `gemini-1.5-flash`
- ⚠️ **May require paid tier**: `gemini-2.0-flash-lite`, `gemini-2.5-flash`, `gemini-2.5-pro`, `gemini-3-pro-preview`
- 💡 **Recommendation**: Start with `gemini-2.5-flash`, fallback to `gemini-1.5-flash` if quota issues

## Current Configuration

The code is currently set to use: **`gemini-2.5-flash`**

If you encounter quota errors, the code will automatically retry, and you can switch to `gemini-1.5-flash` as a fallback.

