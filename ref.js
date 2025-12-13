import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Load environment variables
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, ".env") });

const API_KEY = process.env.GEMINI_API_KEY;

if (!API_KEY) {
  throw new Error("GEMINI_API_KEY not found in .env file");
}

const ai = new GoogleGenAI({ apiKey: API_KEY });

// Model selection
const MODEL_PRIMARY = "gemini-2.5-flash";     // Fast & balanced
const MODEL_FALLBACK = "gemini-1.5-flash";    // Free-tier friendly fallback

function getModel(modelName) {
  return ai.getGenerativeModel({ model: modelName });
}

/**
 * Check if content contains offensive language
 * @param {string} text - The text to check
 * @param {string} context - Context: "chatbot" or "job_posting"
 * @returns {Promise<{isOffensive: boolean, message: string, details: string}>}
 */
export async function checkOffensiveContent(text, context = "chatbot") {
  if (!text || typeof text !== "string" || text.trim().length === 0) {
    return {
      isOffensive: false,
      message: "Content is valid",
      details: "Empty or invalid input"
    };
  }

  const contextPrompt = context === "job_posting" 
    ? "This is a job posting that will be visible to job seekers. It must be professional and appropriate."
    : "This is a user message in a chatbot conversation.";

  const prompt = `You are a content moderation system. Analyze the following text and determine if it contains offensive, inappropriate, or socially unacceptable language.

Context: ${contextPrompt}

Check for:
- Profanity, curse words, vulgar language
- Sexually explicit content
- Hate speech or discriminatory language
- Threats or violent language
- Socially unacceptable or inappropriate content

Text to analyze: "${text}"

Respond ONLY with a JSON object in this exact format:
{
  "isOffensive": true/false,
  "severity": "low"/"medium"/"high",
  "reason": "brief explanation of why it's offensive or why it's clean",
  "flaggedWords": ["word1", "word2"] or []
}

Be strict but fair. Only flag genuinely offensive content.`;

  try {
    let retries = 3;
    let delay = 1000; // Start with 1 second delay
    let responseText = "";
    let modelName = MODEL_PRIMARY;
    
    while (true) {
      try {
        const model = getModel(modelName);
        const result = await model.generateContent(prompt);
        const text = result.response ? result.response.text() : result.text?.();
        responseText = (text || "").trim();
        break; // Success
      } catch (error) {
        const msg = error?.message || "";
        const status = error?.status || "";
        const isRateOrOverload =
          msg.includes("429") ||
          msg.toLowerCase().includes("rate limit") ||
          msg.toLowerCase().includes("quota") ||
          status === 429 ||
          status === 503 ||
          msg.toLowerCase().includes("overloaded") ||
          msg.toLowerCase().includes("service unavailable");

        if (isRateOrOverload && retries > 0) {
          retries--;
          console.log(`[Gemini] ${modelName} hit ${status || "rate/overload"} (${msg.slice(0, 80)}...). Retrying in ${delay/1000}s...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          delay = Math.min(delay * 2, 10000); // exponential backoff up to 10s
          continue;
        }

        // Try fallback model once if primary fails
        if (modelName === MODEL_PRIMARY) {
          console.log(`[Gemini] switching to fallback model ${MODEL_FALLBACK} after error: ${msg.slice(0, 80)}...`);
          modelName = MODEL_FALLBACK;
          retries = 2;
          delay = 1000;
          continue;
        }

        throw error; // bubble up if retries exhausted and fallback already tried
      }
    }

    if (!responseText) {
      throw new Error("No response from API");
    }

    // Extract JSON from response (handle markdown code blocks)
    let jsonText = responseText;
    if (responseText.includes("```json")) {
      jsonText = responseText.split("```json")[1].split("```")[0].trim();
    } else if (responseText.includes("```")) {
      jsonText = responseText.split("```")[1].split("```")[0].trim();
    }

    const analysis = JSON.parse(jsonText);

    if (analysis.isOffensive) {
      const severity = analysis.severity || "medium";
      const warningMessage = `⚠️ Using offensive language is prohibited. ${severity === "high" ? "This is a serious violation. " : ""}If continued, you will be removed permanently.`;
      
      return {
        isOffensive: true,
        message: warningMessage,
        details: analysis.reason || "Contains offensive content",
        severity: severity,
        flaggedWords: analysis.flaggedWords || []
      };
    }

    return {
      isOffensive: false,
      message: "Content is appropriate",
      details: analysis.reason || "No offensive content detected",
      severity: "none",
      flaggedWords: []
    };
  } catch (error) {
    console.error("Error checking offensive content:", error);
    
    // Fallback: basic keyword check if API fails
    const offensiveKeywords = ["fuck", "porn", "shit", "damn", "bitch", "asshole", "cunt", "nigger", "faggot"];
    const lowerText = text.toLowerCase();
    const foundKeywords = offensiveKeywords.filter(keyword => lowerText.includes(keyword));
    
    if (foundKeywords.length > 0) {
      return {
        isOffensive: true,
        message: "⚠️ Using offensive language is prohibited. If continued, you will be removed permanently.",
        details: `Detected potentially offensive content (fallback detection)`,
        severity: "medium",
        flaggedWords: foundKeywords
      };
    }

    // If API fails and no keywords found, allow content (graceful degradation)
    return {
      isOffensive: false,
      message: "Content check completed",
      details: "API error, but no obvious offensive content detected",
      severity: "none",
      flaggedWords: []
    };
  }
}

/**
 * Check chatbot message for offensive content
 * @param {string} message - User's chat message
 * @returns {Promise<{isOffensive: boolean, message: string, details: string}>}
 */
export async function checkChatbotMessage(message) {
  return await checkOffensiveContent(message, "chatbot");
}

/**
 * Check job posting for offensive content
 * @param {string} jobPosting - Job posting text
 * @returns {Promise<{isOffensive: boolean, message: string, details: string}>}
 */
export async function checkJobPosting(jobPosting) {
  return await checkOffensiveContent(jobPosting, "job_posting");
}

/**
 * Format warning message for display
 * @param {Object} result - Result from checkOffensiveContent
 * @returns {string}
 */
export function formatWarningMessage(result) {
  if (!result.isOffensive) {
    return result.message;
  }

  let warning = result.message;
  if (result.flaggedWords && result.flaggedWords.length > 0) {
    warning += `\nFlagged words: ${result.flaggedWords.join(", ")}`;
  }
  return warning;
}

