import { useEffect, useState } from 'react';

/**
 * Manages a Blob/File ObjectURL strictly: creates a new URL whenever `source` changes,
 * and revokes the previous URL on replacement or component unmount.
 */
export function useObjectUrl(source: Blob | File | null): string | null {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!source) {
      setObjectUrl(null);
      return;
    }

    const nextUrl = URL.createObjectURL(source);
    setObjectUrl(nextUrl);

    return () => {
      URL.revokeObjectURL(nextUrl);
    };
  }, [source]);

  return objectUrl;
}
