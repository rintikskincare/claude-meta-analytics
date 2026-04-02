"use client";

interface GeneratedContent {
  primaryText: string;
  headline: string;
  callToAction: string;
  interests: string[];
  campaignName: string;
  adSetName: string;
  adName: string;
}

interface AdPreviewProps {
  generated: GeneratedContent;
  imagePreviewUrl: string;
  publishImmediately: boolean;
  onCreateAd: () => void;
  onRegenerate: () => void;
  onBack: () => void;
  loading: boolean;
}

const CTA_LABELS: Record<string, string> = {
  LEARN_MORE: "Learn More",
  SIGN_UP: "Sign Up",
  GET_QUOTE: "Get Quote",
  CONTACT_US: "Contact Us",
  SUBSCRIBE: "Subscribe",
  APPLY_NOW: "Apply Now",
  DOWNLOAD: "Download",
  GET_OFFER: "Get Offer",
  SHOP_NOW: "Shop Now",
  BOOK_TRAVEL: "Book Travel",
};

export default function AdPreview({
  generated,
  imagePreviewUrl,
  publishImmediately,
  onCreateAd,
  onRegenerate,
  onBack,
  loading,
}: AdPreviewProps) {
  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Preview Your Ad</h1>
        <span
          className={`text-xs font-semibold px-3 py-1 rounded-full ${
            publishImmediately
              ? "bg-red-500/20 text-red-400"
              : "bg-zinc-700 text-zinc-300"
          }`}
        >
          {publishImmediately ? "Will publish live" : "Will save as draft"}
        </span>
      </div>

      {/* Ad Preview Card */}
      <div className="rounded-xl bg-zinc-800 border border-zinc-700 overflow-hidden">
        {/* Ad copy */}
        <div className="px-5 pt-5 pb-3">
          <p className="text-white text-sm leading-relaxed">
            {generated.primaryText}
          </p>
        </div>

        {/* Image */}
        {imagePreviewUrl && (
          <img
            src={imagePreviewUrl}
            alt="Ad creative"
            className="w-full object-cover"
          />
        )}

        {/* Headline + CTA */}
        <div className="px-5 py-4 bg-zinc-750 flex items-center justify-between border-t border-zinc-700">
          <div>
            <p className="text-white font-semibold text-sm">
              {generated.headline}
            </p>
          </div>
          <span className="text-xs font-semibold bg-zinc-600 text-white px-3 py-1.5 rounded">
            {CTA_LABELS[generated.callToAction] || generated.callToAction}
          </span>
        </div>
      </div>

      {/* Details */}
      <div className="rounded-xl bg-zinc-800 border border-zinc-700 p-5 space-y-4">
        <h2 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
          Campaign Details
        </h2>

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-zinc-500">Campaign</span>
            <p className="text-white">{generated.campaignName}</p>
          </div>
          <div>
            <span className="text-zinc-500">Ad Set</span>
            <p className="text-white">{generated.adSetName}</p>
          </div>
          <div>
            <span className="text-zinc-500">Ad</span>
            <p className="text-white">{generated.adName}</p>
          </div>
          <div>
            <span className="text-zinc-500">CTA</span>
            <p className="text-white">
              {CTA_LABELS[generated.callToAction] || generated.callToAction}
            </p>
          </div>
        </div>

        <div>
          <span className="text-zinc-500 text-sm">Interest Targeting</span>
          <div className="flex flex-wrap gap-2 mt-1">
            {generated.interests.map((interest, i) => (
              <span
                key={i}
                className="text-xs bg-zinc-700 text-zinc-300 px-2 py-1 rounded"
              >
                {interest}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={onBack}
          disabled={loading}
          className="flex-1 rounded-lg bg-zinc-700 px-4 py-3 font-semibold text-white hover:bg-zinc-600 disabled:opacity-50 transition-colors"
        >
          Back
        </button>
        <button
          onClick={onRegenerate}
          disabled={loading}
          className="flex-1 rounded-lg bg-zinc-700 px-4 py-3 font-semibold text-white hover:bg-zinc-600 disabled:opacity-50 transition-colors"
        >
          Regenerate
        </button>
        <button
          onClick={onCreateAd}
          disabled={loading}
          className={`flex-1 rounded-lg px-4 py-3 font-semibold text-white disabled:opacity-50 transition-colors ${
            publishImmediately
              ? "bg-red-600 hover:bg-red-500"
              : "bg-blue-600 hover:bg-blue-500"
          }`}
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <svg
                className="animate-spin h-5 w-5"
                viewBox="0 0 24 24"
                fill="none"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                />
              </svg>
              Creating...
            </span>
          ) : (
            "Create Ad"
          )}
        </button>
      </div>
    </div>
  );
}
