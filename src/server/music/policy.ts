const DOWNLOAD_DELAY_MS = 5 * 60 * 1000;

export function getDownloadAvailableAt(createdAt: Date) {
  return new Date(createdAt.getTime() + DOWNLOAD_DELAY_MS);
}

export function isDownloadReady(createdAt: Date, now = new Date()) {
  return now.getTime() >= getDownloadAvailableAt(createdAt).getTime();
}

