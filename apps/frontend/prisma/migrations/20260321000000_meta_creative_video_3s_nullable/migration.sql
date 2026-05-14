-- Runs after meta_ads_creative_daily exists. 3s may be unknown when actions omit 3_second_video_view.
ALTER TABLE "meta_ads_creative_daily" ALTER COLUMN "video_3s_views" DROP NOT NULL;
ALTER TABLE "meta_ads_creative_daily" ALTER COLUMN "video_3s_views" DROP DEFAULT;
