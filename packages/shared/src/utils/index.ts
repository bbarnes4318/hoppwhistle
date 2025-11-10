// Shared utility functions

export const formatPhoneNumber = (phone: string): string => {
  // Basic phone number formatting utility
  return phone.replace(/\D/g, '');
};

export const isValidPhoneNumber = (phone: string): boolean => {
  const cleaned = formatPhoneNumber(phone);
  return cleaned.length >= 10 && cleaned.length <= 15;
};

