import OpenAI from "openai";
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export const extractTags = async (text) => {
  if (!text || text.trim().length < 5) return [text.trim().toLowerCase()];

  const prompt = `Extract 3-5 relevant, concise personal finance tags (single words or short phrases, no duplicates) for this expense note: "${text}". Output only the tags, comma-separated, without any additional text.`;

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 50,
    });

    const content = response?.choices?.[0]?.message?.content?.trim() || "";
    if (!content.includes(",")) {
      return text
        .split(" ")
        .slice(0, 3)
        .map((tag) => tag.trim().toLowerCase());
    }
    const tags = [
      ...new Set(
        content
          .split(",")
          .map((tag) => tag.trim().toLowerCase())
          .filter((tag) => tag.length > 0 && tag.length <= 20)
      ),
    ];

    return tags;
  } catch (error) {
    console.error("Error extracting tags with OpenAI:", error.message);
    return [];
  }
};
