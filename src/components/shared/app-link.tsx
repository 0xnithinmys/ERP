import NextLink from "next/link";
import type { ComponentProps } from "react";

/**
 * App-wide Link with automatic prefetching OFF by default. Every page here is
 * dynamic and user-specific, so viewport prefetches only cost server renders —
 * and on busy list pages they raced with (and dropped) search navigations.
 */
export default function Link({ prefetch = false, ...props }: ComponentProps<typeof NextLink>) {
  return <NextLink prefetch={prefetch} {...props} />;
}
