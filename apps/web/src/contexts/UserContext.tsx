'use client';

/**
 * Project Cortex | User Context
 *
 * Provides user role information throughout the app.
 * Supports: admin, operator, publisher roles
 */

import { createContext, useContext, useState, ReactNode } from 'react';

export type UserRole = 'admin' | 'operator' | 'publisher';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  publisherId?: string; // Only for publisher role
  publisherName?: string; // Display name for publisher
}

interface UserContextValue {
  user: User | null;
  isAuthenticated: boolean;
  isPublisher: boolean;
  isOperator: boolean;
  isAdmin: boolean;
  setUser: (user: User | null) => void;
  switchRole: (role: UserRole) => void; // For demo/testing
}

const UserContext = createContext<UserContextValue | undefined>(undefined);

// Mock user for development
const mockOperator: User = {
  id: 'usr_001',
  name: 'Command Operator',
  email: 'operator@hopwhistle.com',
  role: 'operator',
};

const mockPublisher: User = {
  id: 'usr_pub_001',
  name: 'LeadGenius Marketing',
  email: 'traffic@leadgenius.com',
  role: 'publisher',
  publisherId: 'pub_leadgenius',
  publisherName: 'LeadGenius Marketing',
};

const mockAdmin: User = {
  id: 'usr_admin',
  name: 'System Admin',
  email: 'admin@hopwhistle.com',
  role: 'admin',
};

export function UserProvider({ children }: { children: ReactNode }) {
  // Default to operator for development
  const [user, setUser] = useState<User | null>(mockOperator);

  const isAuthenticated = user !== null;
  const isPublisher = user?.role === 'publisher';
  const isOperator = user?.role === 'operator';
  const isAdmin = user?.role === 'admin';

  // Switch role for demo purposes
  const switchRole = (role: UserRole) => {
    switch (role) {
      case 'publisher':
        setUser(mockPublisher);
        break;
      case 'admin':
        setUser(mockAdmin);
        break;
      default:
        setUser(mockOperator);
    }
  };

  return (
    <UserContext.Provider
      value={{
        user,
        isAuthenticated,
        isPublisher,
        isOperator,
        isAdmin,
        setUser,
        switchRole,
      }}
    >
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error('useUser must be used within a UserProvider');
  }
  return context;
}

export default UserContext;
