/** Names the preview size limits a Community catalog template must meet. */
// CONTRACT: documents/contracts/templates.md#manifest

const KIB = 1024;

export const THUMBNAIL_MAX_BYTES = 512 * KIB;
export const THUMBNAIL_MIN_WIDTH = 400;
export const THUMBNAIL_MAX_WIDTH = 1600;
export const SAMPLE_MAX_BYTES = 10 * KIB * KIB;
