"use client";

import { useState, useRef } from "react";

export interface AdFormData {
  description: string;
  location: string;
  dailyBudget: number;
  ageMin: number;
  ageMax: number;
  imageFile: File | null;
  imageBase64: string;
  imagePreviewUrl: string;
  publishImmediately: boolean;
}

interface AdFormProps {
  onSubmit: (data: AdFormData) => void;
  loading: boolean;
  initialData?: AdFormData | null;
}

export default function AdForm({ onSubmit, loading, initialData }: AdFormProps) {
  const [formData, setFormData] = useState<AdFormData>(
    initialData ?? {
      description: "",
      location: "",
      dailyBudget: 10,
      ageMin: 25,
      ageMax: 55,
      imageFile: null,
      imageBase64: "",
      imagePreviewUrl: "",
      publishImmediately: false,
    }
  );
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1];
      setFormData((prev) => ({
        ...prev,
        imageFile: file,
        imageBase64: base64,
        imagePreviewUrl: result,
      }));
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.imageBase64) {
      alert("Please upload an image for your ad.");
      return;
    }
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6 max-w-xl mx-auto">
      <h1 className="text-2xl font-bold text-white mb-2">Create Facebook Ad</h1>
      <p className="text-zinc-400 text-sm mb-6">
        Describe your product and let AI generate the ad copy.
      </p>

      <div>
        <label className="block text-sm font-medium text-zinc-300 mb-1">
          Product / Service Description
        </label>
        <textarea
          required
          rows={4}
          placeholder='e.g. "I help estate agents get more buyers through targeted social media marketing"'
          className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
          value={formData.description}
          onChange={(e) =>
            setFormData((prev) => ({ ...prev, description: e.target.value }))
          }
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-zinc-300 mb-1">
          Target Location
        </label>
        <input
          type="text"
          required
          placeholder="e.g. Dublin, Ireland"
          className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-3 text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={formData.location}
          onChange={(e) =>
            setFormData((prev) => ({ ...prev, location: e.target.value }))
          }
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-zinc-300 mb-1">
          Daily Budget (EUR)
        </label>
        <input
          type="number"
          required
          min={1}
          className="w-full rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          value={formData.dailyBudget}
          onChange={(e) =>
            setFormData((prev) => ({
              ...prev,
              dailyBudget: Number(e.target.value),
            }))
          }
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-zinc-300 mb-1">
          Target Age Range
        </label>
        <div className="flex items-center gap-3">
          <input
            type="number"
            required
            min={18}
            max={65}
            className="w-24 rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={formData.ageMin}
            onChange={(e) =>
              setFormData((prev) => ({
                ...prev,
                ageMin: Number(e.target.value),
              }))
            }
          />
          <span className="text-zinc-400">to</span>
          <input
            type="number"
            required
            min={18}
            max={65}
            className="w-24 rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            value={formData.ageMax}
            onChange={(e) =>
              setFormData((prev) => ({
                ...prev,
                ageMax: Number(e.target.value),
              }))
            }
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-zinc-300 mb-1">
          Ad Image
        </label>
        <div
          onClick={() => fileInputRef.current?.click()}
          className="w-full rounded-lg bg-zinc-800 border-2 border-dashed border-zinc-600 px-4 py-8 text-center cursor-pointer hover:border-zinc-500 transition-colors"
        >
          {formData.imagePreviewUrl ? (
            <img
              src={formData.imagePreviewUrl}
              alt="Ad preview"
              className="max-h-48 mx-auto rounded-lg"
            />
          ) : (
            <div className="text-zinc-400">
              <p className="text-lg mb-1">Click to upload image</p>
              <p className="text-sm">JPG or PNG, recommended 1080x1080px</p>
            </div>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png"
          className="hidden"
          onChange={handleImageChange}
        />
      </div>

      <div className="flex items-center justify-between rounded-lg bg-zinc-800 border border-zinc-700 px-4 py-3">
        <div>
          <span className="text-sm font-medium text-zinc-300">
            Publish immediately
          </span>
          {formData.publishImmediately && (
            <span className="ml-3 text-xs font-semibold text-red-400">
              This will spend real money
            </span>
          )}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={formData.publishImmediately}
          onClick={() =>
            setFormData((prev) => ({
              ...prev,
              publishImmediately: !prev.publishImmediately,
            }))
          }
          className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
            formData.publishImmediately ? "bg-red-500" : "bg-zinc-600"
          }`}
        >
          <span
            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              formData.publishImmediately ? "translate-x-6" : "translate-x-1"
            }`}
          />
        </button>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="w-full rounded-lg bg-blue-600 px-4 py-3 font-semibold text-white hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
            Generating with AI...
          </span>
        ) : (
          "Generate Ad"
        )}
      </button>
    </form>
  );
}
