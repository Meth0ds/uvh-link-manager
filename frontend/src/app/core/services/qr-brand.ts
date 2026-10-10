// Outlines of the existing Manrope 800 wordmark (SIL Open Font License).
// Vector paths keep exported PNGs independent of theme and font loading.
export const QR_BRAND_LETTERS = "M542 -32Q415 -32 335.0 11.0Q255 54 210.5 120.0Q166 186 147.0 257.5Q128 329 124.0 388.0Q120 447 120 474V1080H396V570Q396 533 400.0 475.5Q404 418 425.0 360.0Q446 302 493.5 263.0Q541 224 628 224Q663 224 703.0 235.0Q743 246 778.0 277.5Q813 309 835.5 370.5Q858 432 858 532L1014 458Q1014 330 962.0 218.0Q910 106 805.5 37.0Q701 -32 542 -32ZM892 0V358H858V1080H1132V0ZM1524.0 0 1132.0 1080H1404.0L1660.0 332L1916.0 1080H2188.0L1796.0 0ZM2924.0 0V510Q2924.0 547 2920.0 604.5Q2916.0 662 2895.0 720.0Q2874.0 778 2826.5 817.0Q2779.0 856 2692.0 856Q2657.0 856 2617.0 845.0Q2577.0 834 2542.0 802.5Q2507.0 771 2484.5 710.0Q2462.0 649 2462.0 548L2306.0 622Q2306.0 750 2358.0 862.0Q2410.0 974 2514.5 1043.0Q2619.0 1112 2778.0 1112Q2905.0 1112 2985.0 1069.0Q3065.0 1026 3109.5 960.0Q3154.0 894 3173.0 822.5Q3192.0 751 3196.0 692.0Q3200.0 633 3200.0 606V0ZM2186.0 0V1440H2428.0V700H2462.0V0Z";
export const QR_BRAND_DOT = "M3324.0 0V272H3596.0V0Z";

export function paintQrBrand(context: CanvasRenderingContext2D, size: number, relativeScale = 1): void {
  const markSize = size * relativeScale;
  const surround = Math.round(markSize * 0.27);
  const badge = Math.round(markSize * 0.22);
  context.save();
  context.fillStyle = "#FFFFFF";
  context.beginPath();
  context.roundRect((size - surround) / 2, (size - surround) / 2, surround, surround, markSize * 0.047);
  context.fill();
  context.fillStyle = "#262821";
  context.beginPath();
  context.roundRect((size - badge) / 2, (size - badge) / 2, badge, badge, markSize * 0.025);
  context.fill();
  // Font bounds: x120..3596, y-32..1440. Match the panel's -.09em spacing.
  const scale = markSize * 0.185 / 3476;
  context.translate(size / 2 - 1858 * scale, size / 2 + 704 * scale);
  context.scale(scale, -scale);
  context.fillStyle = "#FFFFFF";
  context.fill(new Path2D(QR_BRAND_LETTERS));
  context.fillStyle = "#F79573";
  context.fill(new Path2D(QR_BRAND_DOT));
  context.restore();
}
