import { OG_LOCALE, translate } from "@/lib/i18n";

/**
 * リンクを共有したときの表示 (OGP と X のカード) のタグ。
 * 渡す文言は、モデル名など作者が書いたものならそのまま使う。
 */
export function shareMeta({
  title,
  description,
  url,
  image,
  imageAlt,
}: {
  title: string;
  description: string;
  url: string;
  image: string;
  imageAlt: string;
}) {
  return [
    { property: "og:title", content: title },
    { property: "og:description", content: description },
    { property: "og:type", content: "website" },
    { property: "og:url", content: url },
    { property: "og:site_name", content: translate("site.name") },
    { property: "og:locale", content: OG_LOCALE },
    { property: "og:image", content: image },
    { property: "og:image:width", content: "1200" },
    { property: "og:image:height", content: "630" },
    { property: "og:image:alt", content: imageAlt },
    { name: "twitter:card", content: "summary_large_image" },
    { name: "twitter:title", content: title },
    { name: "twitter:description", content: description },
    { name: "twitter:image", content: image },
  ];
}
