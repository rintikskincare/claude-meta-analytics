import { NextResponse } from "next/server";
import { createFullCampaign } from "@/app/lib/meta";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const {
      imageBase64,
      campaignName,
      adSetName,
      adName,
      primaryText,
      headline,
      callToAction,
      interests,
      location,
      ageMin,
      ageMax,
      dailyBudget,
      publishImmediately,
    } = body;

    if (!imageBase64 || !campaignName || !primaryText || !headline) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    const result = await createFullCampaign({
      imageBase64,
      campaignName,
      adSetName,
      adName,
      primaryText,
      headline,
      callToAction,
      interests,
      location,
      ageMin,
      ageMax,
      dailyBudget,
      status: publishImmediately ? "ACTIVE" : "PAUSED",
    });

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
