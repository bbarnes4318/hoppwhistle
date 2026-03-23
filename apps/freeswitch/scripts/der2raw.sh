#!/bin/sh
# der2raw.sh - Convert DER-encoded ECDSA signature to JWS raw R||S format
# Usage: openssl dgst ... -binary | sh der2raw.sh | openssl base64 -A
# 
# DER format: 30 <len> 02 <rlen> <R> 02 <slen> <S>
# JWS format: <R_padded_32bytes><S_padded_32bytes> = exactly 64 bytes
#
# Reads DER binary from stdin, writes 64-byte raw R||S to stdout

# Save DER to temp file
TMPDER=$(mktemp)
TMPRAW=$(mktemp)
cat > "$TMPDER"

# Extract R and S using openssl asn1parse
# The DER signature is: SEQUENCE { INTEGER R, INTEGER S }
# We use dd to extract the raw bytes based on parsed offsets

# Get hex dump
HEX=$(od -An -tx1 < "$TMPDER" | tr -d ' \n')

# Parse: 30 <tlen> 02 <rlen> <R_bytes> 02 <slen> <S_bytes>
# Positions in hex string (each byte = 2 hex chars)
RLEN=$(printf '%d' "0x$(echo "$HEX" | cut -c7-8)")

# R starts at position 9 (byte 5, 0-indexed byte 4)
RSTART=9
REND=$((RSTART + RLEN * 2 - 1))
R=$(echo "$HEX" | cut -c${RSTART}-${REND})

# S tag is right after R
SPOS=$((REND + 1))
# Skip 02 tag (2 chars), then read S length
SLPOS=$((SPOS + 2))
SLEND=$((SLPOS + 1))
SLEN=$(printf '%d' "0x$(echo "$HEX" | cut -c${SLPOS}-${SLEND})")
SSTART=$((SLEND + 1))
SEND=$((SSTART + SLEN * 2 - 1))
S=$(echo "$HEX" | cut -c${SSTART}-${SEND})

# Strip leading 00 pad byte if present (DER uses it for sign bit)
if [ "$RLEN" -eq 33 ]; then R=$(echo "$R" | cut -c3-); fi
if [ "$SLEN" -eq 33 ]; then S=$(echo "$S" | cut -c3-); fi

# Zero-pad to exactly 64 hex chars (32 bytes) each
while [ ${#R} -lt 64 ]; do R="00${R}"; done
while [ ${#S} -lt 64 ]; do S="00${S}"; done

# Convert hex to binary and write to stdout
# Use printf with \x escapes - process 2 chars at a time
COMBINED="${R}${S}"
i=1
while [ $i -le 128 ]; do
    BYTE=$(echo "$COMBINED" | cut -c${i}-$((i+1)))
    printf "\\x${BYTE}"
    i=$((i + 2))
done

rm -f "$TMPDER" "$TMPRAW"
