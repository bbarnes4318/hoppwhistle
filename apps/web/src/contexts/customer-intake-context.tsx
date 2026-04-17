'use client';

import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react';
import { CustomerIntakeData, DEFAULT_INTAKE_DATA } from '@/types/customer-intake-types';

// ============================================================================
// Context Type
// ============================================================================

interface CustomerIntakeContextType {
 formData: CustomerIntakeData;
 setFormData: (data: CustomerIntakeData) => void;
 updateField: <K extends keyof CustomerIntakeData>(key: K, value: CustomerIntakeData[K]) => void;
 clearFormData: () => void;
 isFormComplete: boolean;
}

// ============================================================================
// Context
// ============================================================================

const CustomerIntakeContext = createContext<CustomerIntakeContextType | null>(null);

// ============================================================================
// Hook
// ============================================================================

export function useCustomerIntake(): CustomerIntakeContextType {
 const context = useContext(CustomerIntakeContext);
 if (!context) {
 throw new Error('useCustomerIntake must be used within a CustomerIntakeProvider');
 }
 return context;
}

// ============================================================================
// Provider
// ============================================================================

interface CustomerIntakeProviderProps {
 children: ReactNode;
}

export function CustomerIntakeProvider({ children }: CustomerIntakeProviderProps): JSX.Element {
 const [formData, setFormDataState] = useState<CustomerIntakeData>(DEFAULT_INTAKE_DATA);

 const setFormData = useCallback((data: CustomerIntakeData) => {
 setFormDataState(data);
 }, []);

 const updateField = useCallback(
 <K extends keyof CustomerIntakeData>(key: K, value: CustomerIntakeData[K]) => {
 setFormDataState(prev => ({
 ...prev,
 [key]: value,
 }));
 },
 []
 );

 const clearFormData = useCallback(() => {
 setFormDataState(DEFAULT_INTAKE_DATA);
 }, []);

 // Check if minimum required fields are complete
 const isFormComplete = useMemo(() => {
 return !!(
 formData.firstName &&
 formData.lastName &&
 formData.phone &&
 formData.carrier &&
 formData.policyType &&
 formData.coverage > 0
 );
 }, [formData]);

 const value = useMemo<CustomerIntakeContextType>(
 () => ({
 formData,
 setFormData,
 updateField,
 clearFormData,
 isFormComplete,
 }),
 [formData, setFormData, updateField, clearFormData, isFormComplete]
 );

 return <CustomerIntakeContext.Provider value={value}>{children}</CustomerIntakeContext.Provider>;
}

export default CustomerIntakeProvider;

