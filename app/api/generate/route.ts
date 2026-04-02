import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export async function POST(request: Request) {
  try {
    const { description, location, ageMin, ageMax } = await request.json();

    if (!description || !location) {
      return NextResponse.json(
        { error: "Product description and location are required" },
        { status: 400 }
      );
    }

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `You are an expert Facebook ad copywriter. Generate ad content for the following:

Product/Service: ${description}
Target Location: ${location}
Target Age Range: ${ageMin}-${ageMax}

Return ONLY a JSON object (no markdown, no code blocks) with these exact fields:
- "primaryText": Punchy, benefit-led ad copy. Max 3 sentences.
- "headline": Max 8 words, attention-grabbing.
- "callToAction": One of: LEARN_MORE, SIGN_UP, GET_QUOTE, CONTACT_US, SUBSCRIBE, APPLY_NOW, DOWNLOAD, GET_OFFER, SHOP_NOW, BOOK_TRAVEL. Pick the best fit.
- "interests": Array of 3-5 relevant interest keywords for Facebook targeting (e.g. "Real estate", "Home buying").
- "campaignName": A short descriptive campaign name.
- "adSetName": A short descriptive ad set name.
- "adName": A short descriptive ad name.

Return ONLY the JSON object, nothing else.`,
        },
      ],
    });

    const textContent = message.content.find((c) => c.type === "text");
    if (!textContent || textContent.type !== "text") {
      return NextResponse.json(
        { error: "No text response from Claude" },
        { status: 500 }
      );
    }

    const jsonMatch = textContent.text.match(/{[\s\S]*}/);
    if (!jsonMatch) {
      return NextResponse.json(
        { error: "Could not parse Claude response as JSON" },
        { status: 500 }
      );
    }

    const generated = JSON.parse(jsonMatch[0]);

    const requiredFields = [
      "primaryText",
      "headline",
      "callToAction",
      "interests",
      "campaignName",
      "adSetName",
      "adName",
    ];
    for (const field of requiredFields) {
      if (!generated[field]) {
        return NextResponse.json(
          { error: `Missing required field: ${field}` },
          { status: 500 }
        );
      }
    }

    return NextResponse.json(generated);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
