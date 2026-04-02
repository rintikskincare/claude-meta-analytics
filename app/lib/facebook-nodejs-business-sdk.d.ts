declare module "facebook-nodejs-business-sdk" {
  export class FacebookAdsApi {
    static init(accessToken: string): FacebookAdsApi;
  }
  export class AdAccount {
    constructor(id: string);
    createAdImage(
      fields: string[],
      params: Record<string, unknown>
    ): Promise<{ _data: { images: Record<string, { hash: string }> } }>;
    createCampaign(
      fields: string[],
      params: Record<string, unknown>
    ): Promise<{ _data: { id: string } }>;
    createAdSet(
      fields: string[],
      params: Record<string, unknown>
    ): Promise<{ _data: { id: string } }>;
    createAdCreative(
      fields: string[],
      params: Record<string, unknown>
    ): Promise<{ _data: { id: string } }>;
    createAd(
      fields: string[],
      params: Record<string, unknown>
    ): Promise<{ _data: { id: string } }>;
  }
  export class Campaign {
    static readonly Fields: {
      name: string;
      objective: string;
      status: string;
      special_ad_categories: string;
    };
  }
  export class AdSet {
    static readonly Fields: {
      name: string;
      campaign_id: string;
      daily_budget: string;
      billing_event: string;
      optimization_goal: string;
      status: string;
      targeting: string;
      promoted_object: string;
      start_time: string;
    };
  }
  const sdk: {
    FacebookAdsApi: typeof FacebookAdsApi;
    AdAccount: typeof AdAccount;
    Campaign: typeof Campaign;
    AdSet: typeof AdSet;
  };
  export default sdk;
}
