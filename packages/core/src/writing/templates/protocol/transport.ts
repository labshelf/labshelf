/** Declares the two ends of the template gallery channel. */

import type { MessageEnd } from "../../../library-ui/protocol/index.js";
import type { GalleryToHost, HostToGallery } from "./messages.js";

/** The gallery side of the channel. */
export type GalleryTransport = MessageEnd<GalleryToHost, HostToGallery>;

/** The host side of the channel. */
export type GalleryHostEnd = MessageEnd<HostToGallery, GalleryToHost>;
