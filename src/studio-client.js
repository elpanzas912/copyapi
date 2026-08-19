// Cliente de YouTube Studio (youtubei / WEB_CREATOR).
// Auth: cookies de sesión + SAPISIDHASH (SHA-1 de SAPISID, origin y timestamp).
import crypto from "node:crypto";

const STUDIO_ORIGIN = "https://studio.youtube.com";

export class StudioClient {
  constructor({ cookie, channelId, clientVersion }) {
    this.cookie = cookie;
    this.channelId = channelId;
    this.clientVersion = clientVersion;
  }

  // SAPISIDHASH: SHA1("<timestamp> <SAPISID>") con key "<origin> <SAPISID>"
  #sapisidHash() {
    const m =
      this.cookie.match(/SAPISID=([^;]+)/) ||
      this.cookie.match(/__Secure-3PAPISID=([^;]+)/);
    if (!m) throw new Error("Cookie sin SAPISID/__Secure-3PAPISID");
    const sapisid = m[1].trim();
    const ts = Math.floor(Date.now() / 1000);
    const sha1 = crypto
      .createHash("sha1")
      .update(`${ts} ${sapisid}`)
      .update(`${STUDIO_ORIGIN} ${sapisid}`)
      .digest("hex");
    return `SAPISIDHASH ${ts}_${sha1}`;
  }

  #context() {
    return {
      client: {
        clientName: 62, // WEB_CREATOR (YouTube Studio)
        clientVersion: this.clientVersion,
        hl: "en",
        gl: "US",
      },
      user: {
        delegationContext: {
          externalChannelId: this.channelId,
          roleType: { channelRoleType: "CREATOR_CHANNEL_ROLE_TYPE_OWNER" },
        },
      },
    };
  }

  async #call(endpoint, body) {
    const res = await fetch(`${STUDIO_ORIGIN}/youtubei/v1/${endpoint}?alt=json`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: STUDIO_ORIGIN,
        authorization: this.#sapisidHash(),
        cookie: this.cookie,
        "user-agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
        "x-goog-authuser": "1",
        "x-origin": STUDIO_ORIGIN,
        "x-youtube-client-name": "62",
        "x-youtube-client-version": this.clientVersion,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `youtubei ${endpoint} HTTP ${res.status}: ${text.slice(0, 300)}`
      );
    }
    return res.json();
  }

  // Estado de verificaciones + copyright de un video por ID.
  // Devuelve { copyrightCheckStatus, summaryStatus, thirdPartyClaim, commercialBlock,
  //           copyrightSummaryStatus, activeClaimsCount, processingDone }
  async getCreatorVideos(videoId) {
    const data = await this.#call("creator/get_creator_videos", {
      context: this.#context(),
      failOnError: true,
      videoIds: [videoId],
      mask: {
        status: true,
        statusDetails: { all: true },
        ownedClaimDetails: { all: true },
        videoId: true,
        permissions: { all: true },
        origin: true,
        inlineEditProcessingStatus: true,
        monetization: { all: true },
        allRestrictions: { all: true },
        videoPrechecks: { all: true },
        audienceRestriction: { all: true },
        videoStreamUrl: true,
        visibility: { all: true },
        responseStatus: { all: true },
        contentType: true,
        channelId: true,
        features: { all: true },
        draftStatus: true,
        videoAdvertiserSpecificAgeGates: {},
        claimDetails: { all: true },
        commentsDisabledInternally: true,
        music: { all: true },
      },
    });
    return this.#parseCreatorVideo(data, videoId);
  }

  #parseCreatorVideo(data, videoId) {
    const video = data?.videos?.find((v) => v.videoId === videoId) || data?.videos?.[0];
    if (!video) return { found: false };

    const prechecks =
      video.videoPrechecks?.videoUploadChecksNotMonetized ||
      video.videoPrechecks?.videoUploadChecksMonetized ||
      {};

    return {
      found: true,
      // UPLOAD_CHECKS_DATA_COPYRIGHT_STATUS_NOT_STARTED | ..._COMPLETED
      copyrightCheckStatus:
        prechecks.copyrightCheck?.checkStatus || "UNKNOWN",
      summaryStatus: prechecks.checksSummary?.status || "UNKNOWN",
      // booleanos directos
      thirdPartyClaim: !!video.claimDetails?.videoHasThirdPartyClaim,
      commercialBlock: !!video.claimDetails?.videoHasCommercialBlock,
      // VIDEO_COPYRIGHT_SUMMARY_STATUS_NO_CLAIMS_FOUND | ..._COPYRIGHT_CONTENT_FOUND
      copyrightSummaryStatus:
        video.copyrightSummary?.videoCopyrightSummaryStatus || "UNKNOWN",
      activeClaimsCount:
        video.copyrightSummary?.activeThirdPartyClaimsCount || 0,
      restrictions: video.allRestrictions?.restrictions || [],
    };
  }

  // Detalle completo de claims: asset, dueño, política, territorios.
  async listReceivedClaims(videoId) {
    const data = await this.#call("creator/list_creator_received_claims", {
      context: this.#context(),
      videoId,
      criticalRead: true,
      includeLicensingOptions: false,
      includeCommunicationEmail: false,
      isCreatorMusicV2: true,
    });
    const owners = Object.fromEntries(
      (data.contentOwners || []).map((o) => [o.contentOwnerId, o.displayName])
    );
    return (data.receivedClaims || []).map((c) => ({
      claimId: c.claimId,
      assetId: c.assetId,
      type: c.type, // CLAIM_TYPE_AUDIOVISUAL | CLAIM_TYPE_AUDIO | ...
      status: c.status, // RECEIVED_CLAIM_STATUS_ACTIVE
      asset: c.asset?.metadata || null, // titulo, artista, sello
      claimant: owners[c.contentOwnerIds?.[0]] || null, // ej: UMG
      policyType: c.claimPolicy?.primaryPolicy?.policyType || null, // POLICY_TYPE_MONETIZE|BLOCK|TRACK
      territories: this.#territories(c.claimPolicy?.primaryPolicy?.territories),
      match: c.matchDetails || null,
      embedding: c.claimPolicy?.embedding || null,
      syndication: c.claimPolicy?.syndication || null,
    }));
  }

  // Segmentos exactos matcheados (startMillis/endMillis) por claim.
  async getClaimMatches(videoId, claimId) {
    const data = await this.#call("copyright/get_creator_received_claim_matches", {
      context: this.#context(),
      videoId,
      channelId: this.channelId,
      claimId,
    });
    return (data?.matches?.claimMatches || []).map((m) => ({
      matchType: m.matchType,
      startMillis: m.videoSegment?.startMillis,
      endMillis: m.videoSegment?.endMillis,
    }));
  }

  // Borrar video del canal (endpoint interno de Studio, confirmado en HAR: youtubei/v1/video/delete).
  async deleteVideo(videoId) {
    await this.#call("video/delete", {
      context: this.#context(),
      videoId,
    });
    return true;
  }

  #territories(territories) {
    if (!territories?.entries) return null;
    const included = territories.entries.filter((e) => e.included).map((e) => e.territory);
    const excluded = territories.entries.filter((e) => !e.included).map((e) => e.territory);
    return { included, excluded };
  }
}
