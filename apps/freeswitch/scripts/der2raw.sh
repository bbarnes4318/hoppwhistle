#!/bin/sh
# der2raw.sh - Convert DER-encoded ECDSA signature to JWS raw R||S format
# Usage: openssl dgst ... -binary | sh der2raw.sh | openssl base64 -A
# 
# DER format: 30 <len> 02 <rlen> <R> 02 <slen> <S>
# JWS format: <R_padded_32bytes><S_padded_32bytes> = exactly 64 bytes
#
# Reads DER binary from stdin, writes 64-byte raw R||S to stdout

# Read DER binary into hex
HEX=$(od -An -tx1 | tr -d ' \n')

# Parse ASN.1 SEQUENCE
# Skip: 30 <total_len> 02 <r_len>
# Byte 0: 0x30 (SEQUENCE)
# Byte 1: total length
# Byte 2: 0x02 (INTEGER tag for R)
# Byte 3: R length
R_LEN_HEX=$(echo "$HEX" | cut -c7-8)
R_LEN=$((16#$R_LEN_HEX))

# R value starts at byte 4, length R_LEN
R_START=9
R_END=$((R_START + R_LEN * 2 - 1))
R_HEX=$(echo "$HEX" | cut -c${R_START}-${R_END})

# After R: 02 <s_len> <S>
S_TAG_POS=$((R_END + 1))
S_LEN_POS=$((S_TAG_POS + 2))
S_LEN_END=$((S_LEN_POS + 1))
S_LEN_HEX=$(echo "$HEX" | cut -c${S_LEN_POS}-${S_LEN_END})
S_LEN=$((16#$S_LEN_HEX))

S_START=$((S_LEN_END + 1))
S_END=$((S_START + S_LEN * 2 - 1))
S_HEX=$(echo "$HEX" | cut -c${S_START}-${S_END})

# If R or S has leading 00 padding (sign byte), strip it
if [ $R_LEN -eq 33 ]; then
    R_HEX=$(echo "$R_HEX" | cut -c3-)
fi
if [ $S_LEN -eq 33 ]; then
    S_HEX=$(echo "$S_HEX" | cut -c3-)
fi

# Pad R and S to exactly 32 bytes (64 hex chars) each
while [ ${#R_HEX} -lt 64 ]; do R_HEX="00${R_HEX}"; done
while [ ${#S_HEX} -lt 64 ]; do S_HEX="00${S_HEX}"; done

# Output 64 bytes of raw R||S binary
printf '%s%s' "$R_HEX" "$S_HEX" | sed 's/../\\x&/g' | xargs printf
