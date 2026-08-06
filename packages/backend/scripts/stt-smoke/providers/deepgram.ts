// Эталон для сравнения: существующий прод-провайдер Deepgram, без изменений в src/.

import { DeepgramSTT } from '../../../src/stt/deepgram.js';
import type { SmokeRunner } from '../types.js';

export function createDeepgramRunner(language: string): SmokeRunner {
  const stt = new DeepgramSTT();

  return {
    async start(onEvent) {
      await stt.initialize(language, (result) => {
        onEvent({
          isFinal: result.isFinal,
          text: result.text,
          audioPosSec: result.startSec,
          durationSec: result.durationSec,
        });
      });
    },

    async send(chunk) {
      await stt.processAudio(chunk, 'pcm');
    },

    async finish(trailingMs) {
      await stt.finalize();
      // Хвостовые финалы приходят уже после finish() — даём им дойти до callback.
      await new Promise((resolve) => setTimeout(resolve, trailingMs));
      await stt.destroy();
    },
  } satisfies SmokeRunner;
}
