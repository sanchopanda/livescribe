/**
 * Alternative audio capture using MediaRecorder API
 * This can capture audio directly in OGG Opus or WebM Opus format
 * Useful for services like Yandex SpeechKit that require OGG Opus
 */

export interface MediaRecorderOptions {
  mimeType?: string; // e.g., 'audio/webm;codecs=opus' or 'audio/ogg;codecs=opus'
  timeslice?: number; // Chunk interval in milliseconds (default: 1000)
  onChunk?: (chunk: Blob) => void;
}

export class MediaRecorderCapture {
  private mediaRecorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private isRecording = false;

  /**
   * Get supported MIME types for Opus encoding
   */
  static getSupportedMimeTypes(): string[] {
    const types = [
      'audio/webm;codecs=opus',
      'audio/ogg;codecs=opus',
      'audio/webm',
      'audio/ogg',
    ];

    return types.filter((type) => MediaRecorder.isTypeSupported(type));
  }

  /**
   * Start recording with MediaRecorder
   */
  async start(stream: MediaStream, options: MediaRecorderOptions = {}): Promise<void> {
    if (this.isRecording) {
      throw new Error('Already recording');
    }

    this.stream = stream;

    // Find supported MIME type
    const supportedTypes = MediaRecorderCapture.getSupportedMimeTypes();
    const mimeType = options.mimeType || supportedTypes[0];

    if (!mimeType) {
      throw new Error('No supported audio codec found. Opus codec is required.');
    }

    console.log(`Using MediaRecorder with MIME type: ${mimeType}`);

    try {
      this.mediaRecorder = new MediaRecorder(stream, {
        mimeType,
        audioBitsPerSecond: 32000, // 32 kbps for speech
      });

      // Handle data chunks
      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0 && options.onChunk) {
          options.onChunk(event.data);
        }
      };

      this.mediaRecorder.onerror = (event) => {
        console.error('MediaRecorder error:', event);
      };

      // Start recording with timeslice (chunk interval)
      const timeslice = options.timeslice || 1000; // 1 second chunks
      this.mediaRecorder.start(timeslice);

      this.isRecording = true;
      console.log('MediaRecorder started');
    } catch (err) {
      console.error('Failed to start MediaRecorder:', err);
      throw err;
    }
  }

  /**
   * Stop recording
   */
  async stop(): Promise<void> {
    if (!this.isRecording || !this.mediaRecorder) {
      return;
    }

    return new Promise((resolve) => {
      if (this.mediaRecorder) {
        this.mediaRecorder.onstop = () => {
          this.isRecording = false;
          this.mediaRecorder = null;
          resolve();
        };

        this.mediaRecorder.stop();
      } else {
        resolve();
      }
    });
  }

  /**
   * Get current recording state
   */
  getState(): 'inactive' | 'recording' | 'paused' {
    return this.mediaRecorder?.state || 'inactive';
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    if (this.mediaRecorder && this.isRecording) {
      this.mediaRecorder.stop();
    }

    if (this.stream) {
      this.stream.getTracks().forEach((track) => track.stop());
    }

    this.mediaRecorder = null;
    this.stream = null;
    this.isRecording = false;
  }
}

