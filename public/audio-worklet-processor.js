// audio-worklet-processor.js - Low Latency Audio Processing
// This runs in a separate audio rendering thread for minimal latency

// Volume Meter Processor
class VolumeMeterProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this._volume = 0;
        this._updateIntervalInMS = 50;
        this._nextUpdateFrame = this._updateIntervalInMS / 1000 * sampleRate;
        this._framesSinceLastUpdate = 0;
    }

    static get parameterDescriptors() {
        return [{
            name: 'smoothing',
            defaultValue: 0.8,
            minValue: 0,
            maxValue: 1
        }];
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (!input || !input.length) return true;

        const smoothing = parameters.smoothing[0];
        const channel = input[0];

        // Calculate RMS
        let sum = 0;
        for (let i = 0; i < channel.length; i++) {
            sum += channel[i] * channel[i];
        }
        const rms = Math.sqrt(sum / channel.length);

        // Smooth the volume
        this._volume = Math.max(rms, this._volume * smoothing);

        this._framesSinceLastUpdate += channel.length;
        if (this._framesSinceLastUpdate >= this._nextUpdateFrame) {
            this.port.postMessage({
                type: 'volume',
                volume: this._volume * 100
            });
            this._framesSinceLastUpdate = 0;
        }

        return true;
    }
}

// Gain Processor with smooth transitions
class SmoothGainProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this._currentGain = 1;
        this._targetGain = 1;
        this._smoothingFactor = 0.005;

        this.port.onmessage = (event) => {
            if (event.data.type === 'setGain') {
                this._targetGain = event.data.gain;
            }
        };
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        const output = outputs[0];

        if (!input || !input.length) return true;

        for (let channel = 0; channel < input.length; channel++) {
            const inputChannel = input[channel];
            const outputChannel = output[channel];

            for (let i = 0; i < inputChannel.length; i++) {
                // Smooth gain transition to avoid clicks
                this._currentGain += (this._targetGain - this._currentGain) * this._smoothingFactor;
                outputChannel[i] = inputChannel[i] * this._currentGain;
            }
        }

        return true;
    }
}

// Noise Gate Processor
class NoiseGateProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this._threshold = 0.01;
        this._isOpen = false;
        this._holdTime = 0.1; // seconds
        this._holdCounter = 0;
        this._attackTime = 0.005;
        this._releaseTime = 0.05;
        this._envelope = 0;

        this.port.onmessage = (event) => {
            if (event.data.type === 'setThreshold') {
                this._threshold = event.data.threshold;
            }
        };
    }

    process(inputs, outputs, parameters) {
        const input = inputs[0];
        const output = outputs[0];

        if (!input || !input.length) return true;

        const channel = input[0];

        // Calculate peak
        let peak = 0;
        for (let i = 0; i < channel.length; i++) {
            peak = Math.max(peak, Math.abs(channel[i]));
        }

        // Gate logic
        if (peak > this._threshold) {
            this._isOpen = true;
            this._holdCounter = this._holdTime * sampleRate;
        } else if (this._holdCounter > 0) {
            this._holdCounter -= channel.length;
        } else {
            this._isOpen = false;
        }

        // Envelope follower
        const targetEnvelope = this._isOpen ? 1 : 0;
        const rate = this._isOpen ? this._attackTime : this._releaseTime;
        const coef = 1 - Math.exp(-1 / (rate * sampleRate));

        for (let ch = 0; ch < input.length; ch++) {
            const inputChannel = input[ch];
            const outputChannel = output[ch];

            for (let i = 0; i < inputChannel.length; i++) {
                this._envelope += (targetEnvelope - this._envelope) * coef;
                outputChannel[i] = inputChannel[i] * this._envelope;
            }
        }

        return true;
    }
}

// Low Latency Mixer
class MixerProcessor extends AudioWorkletProcessor {
    constructor() {
        super();
        this._gains = new Map();

        this.port.onmessage = (event) => {
            if (event.data.type === 'setChannelGain') {
                this._gains.set(event.data.channel, event.data.gain);
            }
        };
    }

    process(inputs, outputs, parameters) {
        const output = outputs[0];

        if (!output || !output.length) return true;

        // Clear output
        for (let ch = 0; ch < output.length; ch++) {
            output[ch].fill(0);
        }

        // Mix all inputs
        for (let inputIndex = 0; inputIndex < inputs.length; inputIndex++) {
            const input = inputs[inputIndex];
            if (!input || !input.length) continue;

            const gain = this._gains.get(inputIndex) ?? 1;

            for (let ch = 0; ch < Math.min(input.length, output.length); ch++) {
                const inputChannel = input[ch];
                const outputChannel = output[ch];

                for (let i = 0; i < inputChannel.length; i++) {
                    outputChannel[i] += inputChannel[i] * gain;
                }
            }
        }

        // Soft clip to prevent distortion
        for (let ch = 0; ch < output.length; ch++) {
            const outputChannel = output[ch];
            for (let i = 0; i < outputChannel.length; i++) {
                const x = outputChannel[i];
                if (x > 1) outputChannel[i] = 1 - Math.exp(1 - x);
                else if (x < -1) outputChannel[i] = -1 + Math.exp(1 + x);
            }
        }

        return true;
    }
}

// Register all processors
registerProcessor('volume-meter-processor', VolumeMeterProcessor);
registerProcessor('smooth-gain-processor', SmoothGainProcessor);
registerProcessor('noise-gate-processor', NoiseGateProcessor);
registerProcessor('mixer-processor', MixerProcessor);
