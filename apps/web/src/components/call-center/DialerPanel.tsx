import React from 'react';
import { Phone } from 'lucide-react';

interface DialerPanelProps {
  phoneNumber: string;
  setPhoneNumber: (num: string) => void;
  formatPhoneNumber: (value: string) => string;
  handleKeypadPress: (key: string) => void;
  onDial: () => void;
  disabled: boolean;
}

export function DialerPanel({
  phoneNumber,
  setPhoneNumber,
  formatPhoneNumber,
  handleKeypadPress,
  onDial,
  disabled,
}: DialerPanelProps) {
  return (
    <div className="flex-1 flex flex-col p-4 bg-background">
      <div className="mb-4">
        <input
          type="text"
          value={phoneNumber}
          onChange={(e) => setPhoneNumber(formatPhoneNumber(e.target.value.replace(/\D/g, '')))}
          placeholder="(555) 123-4567"
          className="w-full bg-transparent text-2xl text-foreground text-center font-mono py-3 border-b border-border focus:border-primary focus:outline-none transition-colors"
        />
      </div>

      <div className="grid grid-cols-3 gap-2 mb-4">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map((key) => (
          <button
            key={key}
            onClick={() => handleKeypadPress(key)}
            className="aspect-square bg-card hover:bg-muted rounded border border-border flex items-center justify-center text-xl text-foreground font-mono transition-colors"
          >
            {key}
          </button>
        ))}
      </div>

      <div className="flex space-x-3 mt-auto">
        <button
          onClick={() => setPhoneNumber('')}
          className="flex-1 py-3 bg-card hover:bg-muted text-muted-foreground font-mono uppercase tracking-widest text-xs rounded border border-border transition-colors"
        >
          Clear
        </button>
        <button
          disabled={disabled || phoneNumber.replace(/\D/g, '').length !== 10}
          onClick={onDial}
          className="flex-1 py-3 bg-primary hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed text-primary-foreground font-mono uppercase tracking-widest text-xs rounded transition-colors flex items-center justify-center space-x-2"
        >
          <Phone className="w-4 h-4" />
          <span>Dial</span>
        </button>
      </div>
    </div>
  );
}
