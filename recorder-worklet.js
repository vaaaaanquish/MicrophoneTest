// Worklet that simply forwards raw PCM samples to the main thread.
class RecorderProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input.length > 0) {
      // Send a copy of channel 0 only (mono).
      this.port.postMessage(input[0].slice(0));
    }
    return true;
  }
}
registerProcessor('recorder-processor', RecorderProcessor);
