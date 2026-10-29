// QR scanner shared with the snack beat machine (../script.js): the frame is
// shrunk to SCAN_WIDTH, the first code found sets the code size, then the
// frame is cut into overlapping windows of 1.5x that size and every window is
// decoded (painting each found code white and decoding again, because jsQR
// returns one code per call).
(function (global) {
  const SCAN_WIDTH = 960;
  const WINDOW_RATIO = 1.5;
  const STEP_RATIO = 0.4;
  const SAME_CODE_RATIO = 0.6;
  const SEARCH_WINDOW_SIZES = [320, 480, 640];
  const MAX_DECODES_PER_WINDOW = 12;

  function sideOf({ topLeftCorner, topRightCorner, bottomRightCorner, bottomLeftCorner }) {
    const edges = [
      [topLeftCorner, topRightCorner],
      [topRightCorner, bottomRightCorner],
      [bottomRightCorner, bottomLeftCorner],
      [bottomLeftCorner, topLeftCorner],
    ];
    return edges.reduce((sum, [a, b]) => sum + Math.hypot(b.x - a.x, b.y - a.y), 0) / 4;
  }

  function centerOf(location) {
    const points = [location.topLeftCorner, location.topRightCorner, location.bottomRightCorner, location.bottomLeftCorner];
    return {
      x: points.reduce((sum, p) => sum + p.x, 0) / 4,
      y: points.reduce((sum, p) => sum + p.y, 0) / 4,
    };
  }

  function mapLocation(location, fn) {
    return {
      topLeftCorner: fn(location.topLeftCorner),
      topRightCorner: fn(location.topRightCorner),
      bottomRightCorner: fn(location.bottomRightCorner),
      bottomLeftCorner: fn(location.bottomLeftCorner),
    };
  }

  // Start offsets for windows of `size` covering `dimension`, with a final
  // window flush against the far edge.
  function getTilePositions(dimension, size, step) {
    if (dimension <= size) return [0];
    const positions = [];
    for (let pos = 0; pos + size <= dimension; pos += step) positions.push(Math.round(pos));
    const last = dimension - size;
    if (positions[positions.length - 1] !== last) positions.push(last);
    return positions;
  }

  class QRScanner {
    constructor() {
      this.canvas = document.createElement('canvas');
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
      this.scale = 1;
      this.codeSide = null;
    }

    // Call when the video size changes or the camera is switched.
    reset(videoWidth, videoHeight) {
      this.scale = Math.min(1, SCAN_WIDTH / videoWidth);
      this.canvas.width = Math.round(videoWidth * this.scale);
      this.canvas.height = Math.round(videoHeight * this.scale);
      this.codeSide = null;
    }

    // Returns [{ data, location }] in original video-frame coordinates.
    scan(video) {
      this.ctx.drawImage(video, 0, 0, this.canvas.width, this.canvas.height);
      if (this.codeSide === null) this.codeSide = this.measureCodeSide();
      if (this.codeSide === null) return [];

      const size = Math.round(this.codeSide * WINDOW_RATIO);
      const step = this.codeSide * STEP_RATIO;
      const xs = getTilePositions(this.canvas.width, size, step);
      const ys = getTilePositions(this.canvas.height, size, step);
      const detections = [];
      for (const y of ys) {
        for (const x of xs) this.scanWindow(x, y, size, detections);
      }

      const unique = this.dedupe(detections);
      // Nothing found: the measured size may be stale, so measure again next frame.
      if (unique.length === 0) this.codeSide = null;
      const grow = (p) => ({ x: p.x / this.scale, y: p.y / this.scale });
      return unique.map((d) => ({ data: d.data, location: mapLocation(d.location, grow) }));
    }

    measureCodeSide() {
      for (const size of SEARCH_WINDOW_SIZES) {
        const xs = getTilePositions(this.canvas.width, size, size / 2);
        const ys = getTilePositions(this.canvas.height, size, size / 2);
        for (const y of ys) {
          for (const x of xs) {
            const found = this.decodeWindow(x, y, size);
            if (found) return sideOf(found.location);
          }
        }
      }
      return null;
    }

    decodeWindow(x, y, size) {
      const width = Math.min(size, this.canvas.width - x);
      const height = Math.min(size, this.canvas.height - y);
      const tile = this.ctx.getImageData(x, y, width, height);
      const code = jsQR(tile.data, width, height);
      if (!code) return null;
      const shift = (p) => ({ x: p.x + x, y: p.y + y });
      return { data: code.data, location: mapLocation(code.location, shift) };
    }

    scanWindow(x, y, size, detections) {
      for (let i = 0; i < MAX_DECODES_PER_WINDOW; i++) {
        const found = this.decodeWindow(x, y, size);
        if (!found) return;
        detections.push(found);
        this.whiteOut(found.location);
      }
    }

    whiteOut(location) {
      const corners = [location.topLeftCorner, location.topRightCorner, location.bottomRightCorner, location.bottomLeftCorner];
      const c = centerOf(location);
      // Grow the polygon a little so the code's edge modules are fully covered.
      const GROW = 1.08;
      this.ctx.fillStyle = '#ffffff';
      this.ctx.beginPath();
      corners.forEach((p, index) => {
        const px = c.x + (p.x - c.x) * GROW;
        const py = c.y + (p.y - c.y) * GROW;
        if (index === 0) this.ctx.moveTo(px, py);
        else this.ctx.lineTo(px, py);
      });
      this.ctx.closePath();
      this.ctx.fill();
    }

    dedupe(detections) {
      const unique = [];
      for (const detection of detections) {
        const center = centerOf(detection.location);
        const duplicate = unique.some((existing) => {
          const other = centerOf(existing.location);
          return Math.hypot(center.x - other.x, center.y - other.y) < this.codeSide * SAME_CODE_RATIO;
        });
        if (!duplicate) unique.push(detection);
      }
      return unique;
    }
  }

  global.QRScanner = QRScanner;
  global.qrCenterOf = centerOf;
  global.qrSideOf = sideOf;
})(typeof window !== 'undefined' ? window : globalThis);
