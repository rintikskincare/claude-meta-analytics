"use client";

import { useState } from "react";
import AdForm, { AdFormData } from "./components/AdForm";
import AdPreview from "./components/AdPreview";

interface GeneratedContent {
  primaryText: string;
  headline: string;
  callToAction: string;
  interests: string[];
  campaignName: string;
  adSetName: string;
  adName: string;
}

interface CampaignResult {
  campaignId: string;
  adsManagerUrl: string;
  campaignName: string;
}

type Screen = "form" | "preview" | "confirmation";

export default function Home() {
  const [screen, setScreen] = useState<Screen>("form");
  const [formData, setFormData] = useState<AdFormData | null>(null);
  const [generated, setGenerated] = useState<GeneratedContent | null>(null);
  const [result, setResult] = useState<CampaignResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async (data: AdFormData) => {
    setFormData(data);
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: data.description,
          location: data.location,
          ageMin: data.ageMin,
          ageMax: data.ageMax,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to generate ad copy");

      setGenerated(json);
      setScreen("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const handleRegenerate = async () => {
    if (!formData) return;
    await handleGenerate(formData);
  };

  const handleCreateAd = async () => {
    if (!formData || !generated) return;
    setLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/create-campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageBase64: formData.imageBase64,
          campaignName: generated.campaignName,
          adSetName: generated.adSetName,
          adName: generated.adName,
          primaryText: generated.primaryText,
          headline: generated.headline,
          callToAction: generated.callToAction,
          interests: generated.interests,
          location: formData.location,
          ageMin: formData.ageMin,
          ageMax: formData.ageMax,
          dailyBudget: formData.dailyBudget,
          publishImmediately: formData.publishImmediately,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to create campaign");

      setResult({
        campaignId: json.campaignId,
        adsManagerUrl: json.adsManagerUrl,
        campaignName: generated.campaignName,
      });
      setScreen("confirmation");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  };

  const handleStartOver = () => {
    setScreen("form");
    setFormData(null);
    setGenerated(null);
    setResult(null);
    setError(null);
  };

  return (
    <main className="flex-1 flex items-start justify-center px-4 py-12">
      <div className="w-full max-w-2xl">
        {error && (
          <div className="mb-6 rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3 text-red-400 text-sm max-w-xl mx-auto">
            {error}
          </div>
        )}

        {screen === "form" && (
          <AdForm
            onSubmit={handleGenerate}
            loading={loading}
            initialData={formData}
          />
        )}

        {screen === "preview" && generated && formData && (
          <AdPreview
            generated={generated}
            imagePreviewUrl={formData.imagePreviewUrl}
            publishImmediately={formData.publishImmediately}
            onCreateAd={handleCreateAd}
            onRegenerate={handleRegenerate}
            onBack={() => setScreen("form")}
            loading={loading}
          />
        )}

        {screen === "confirmation" && result && (
          <div className="max-w-xl mx-auto text-center space-y-6">
            <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto">
              <svg
                className="w-8 h-8 text-green-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>

            <div>
              <h1 className="text-2xl font-bold text-white mb-2">
                Ad Created Successfully
              </h1>
              <p className="text-zinc-400">
                Campaign &quot;{result.campaignName}&quot; has been created
                {formData?.publishImmediately
                  ? " and is now live."
                  : " as a draft."}
              </p>
            </div>

            <a
              href={result.adsManagerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block rounded-lg bg-blue-600 px-6 py-3 font-semibold text-white hover:bg-blue-500 transition-colors"
            >
              View in Ads Manager
            </a>

            <div>
              <button
                onClick={handleStartOver}
                className="text-zinc-400 hover:text-white text-sm transition-colors"
              >
                Create another ad
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
