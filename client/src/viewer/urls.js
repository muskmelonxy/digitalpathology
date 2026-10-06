export function encodeSlide(root, filename) {
  return `/api/wsi/r/${encodeURIComponent(root)}/${encodeURIComponent(filename)}`;
}

export function withToken(url, token) {
  if (!token) return url;
  const join = url.includes('?') ? '&' : '?';
  return `${url}${join}token=${encodeURIComponent(token)}`;
}

export function thumbnailUrl(root, filename, token) {
  return withToken(`${encodeSlide(root, filename)}/thumbnail.jpg`, token);
}

export function macroUrl(root, filename, token) {
  return withToken(`${encodeSlide(root, filename)}/macro.jpg?explicit=1`, token);
}

export function tileUrl(root, filename, level, x, y, token) {
  return withToken(
    `${encodeSlide(root, filename)}_files/${level}/${x}_${y}.jpeg`,
    token
  );
}
