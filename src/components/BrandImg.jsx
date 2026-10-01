import React from "react";
import { markLogoBroken, useBrand, DEFAULT_LOGO } from "../brand.js";

/** Drop-in replacement for <img src={phoenixLogo} ...>: shows the company's
 *  own logo (Settings -> General -> Company Logo) and falls back to the
 *  built-in Hopenix phoenix when none is set. Accepts every normal <img>
 *  prop (className, alt, style, onClick...). */
export default function BrandImg({ alt = "", ...rest }) {
  const { logo } = useBrand();
  return (
    <img
      {...rest}
      alt={alt}
      src={logo || DEFAULT_LOGO}
      onError={(e) => {
        if (logo) markLogoBroken();
        rest.onError?.(e);
      }}
    />
  );
}
