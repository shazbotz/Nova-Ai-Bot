import OpenAI from "openai";
import axios from "axios";
import { config } from "../config";
import { logger } from "../utils/logger";

export interface ImageResult {
  buffer: Buffer;
  revisedPrompt?: string;
}

export async function generateImage(prompt: string): Promise<ImageResult> {
  const apiKey = config.ai.openai.apiKey;
  if (!apiKey) {
    throw new Error(
      "Image generation requires an OpenAI API key. Set OPENAI_API_KEY in your environment."
    );
  }

  const openai = new OpenAI({
    apiKey,
    ...(config.ai.openai.baseUrl ? { baseURL: config.ai.openai.baseUrl } : {}),
  });

  logger.info("Generating image", { prompt: prompt.slice(0, 80) });

  const response = await openai.images.generate({
    model: "dall-e-3",
    prompt,
    n: 1,
    size: "1024x1024",
    quality: "standard",
    response_format: "url",
  });

  const firstImage = response.data?.[0];
  const imageUrl = firstImage?.url;
  const revisedPrompt = firstImage?.revised_prompt;

  if (!imageUrl) throw new Error("No image URL returned from DALL-E 3.");

  const imageResponse = await axios.get<ArrayBuffer>(imageUrl, {
    responseType: "arraybuffer",
    timeout: 30000,
  });

  return {
    buffer: Buffer.from(imageResponse.data),
    revisedPrompt,
  };
}
