# RTPEngine Testing Guide

## Prerequisites

Install sipp (SIPp):

```bash
# Ubuntu/Debian
sudo apt-get install sipp

# macOS
brew install sipp

# Or build from source
git clone https://github.com/SIPp/sipp.git
cd sipp
./build.sh
```

## Quick Start

```bash
# Start services
cd infra/docker
docker-compose up rtpengine kamailio freeswitch

# Wait for services to be ready
docker-compose ps
```

## Test Scenarios

### 1. Basic INVITE with Media Flow

**UAC (User Agent Client) - Caller:**

```bash
sipp -sn uac \
  -s 1001 \
  -m 1 \
  -l 1 \
  -r 1 \
  -d 5000 \
  -rtp_echo \
  -sf apps/rtpengine/sipp-scenarios/uac_audio.xml \
  localhost:5060
```

**UAS (User Agent Server) - Callee:**

```bash
sipp -sn uas \
  -s 1001 \
  -m 1 \
  -rtp_echo \
  -sf apps/rtpengine/sipp-scenarios/uas_audio.xml \
  localhost:5060
```

### 2. Test NAT Traversal

**Behind NAT (simulated):**

```bash
# UAC with NAT simulation
sipp -sn uac \
  -s 1001 \
  -m 1 \
  -l 1 \
  -r 1 \
  -d 5000 \
  -rtp_echo \
  -sf apps/rtpengine/sipp-scenarios/uac_audio.xml \
  -bind_local 192.168.1.100 \
  localhost:5060
```

### 3. Test SRTP

**With SRTP enabled:**

```bash
# UAC with SRTP
sipp -sn uac \
  -s 1001 \
  -m 1 \
  -l 1 \
  -r 1 \
  -d 5000 \
  -rtp_echo \
  -sf apps/rtpengine/sipp-scenarios/uac_audio.xml \
  -tls_cert client.pem \
  -tls_key client.key \
  localhost:5061
```

### 4. Load Test

**Multiple concurrent calls:**

```bash
# 10 concurrent calls, 100 total calls
sipp -sn uac \
  -s 1001 \
  -m 100 \
  -l 10 \
  -r 1 \
  -d 1000 \
  -rtp_echo \
  -sf apps/rtpengine/sipp-scenarios/uac_audio.xml \
  localhost:5060
```

## SIPp XML Scenarios

SIPp scenario files are located in `apps/rtpengine/sipp-scenarios/`.

### uac_audio.xml (UAC with audio)

```xml
<?xml version="1.0" encoding="ISO-8859-1" ?>
<!DOCTYPE scenario SYSTEM "sipp.dtd">
<scenario name="UAC with Audio">
  <send retrans="500">
    <![CDATA[
      INVITE sip:1001@localhost:5060 SIP/2.0
      Via: SIP/2.0/[transport] [local_ip]:[local_port];branch=[branch]
      From: sipp <sip:sipp@[local_ip]:[local_port]>;tag=[call_number]
      To: sut <sip:1001@localhost:5060>
      Call-ID: [call_id]
      CSeq: 1 INVITE
      Contact: <sip:sipp@[local_ip]:[local_port]>
      Max-Forwards: 70
      Subject: Performance Test
      Content-Type: application/sdp
      Content-Length: [len]

      v=0
      o=user1 53655765 2353687637 IN IP[local_ip_type] [local_ip]
      s=-
      c=IN IP[local_ip_type] [local_ip]
      t=0 0
      m=audio [media_port] RTP/AVP 0 8 18
      a=rtpmap:0 PCMU/8000
      a=rtpmap:8 PCMA/8000
      a=rtpmap:18 G729/8000
      a=sendrecv
    ]]>
  </send>

  <recv response="100" optional="true">
  </recv>

  <recv response="180" optional="true">
  </recv>

  <recv response="200" rtd="true">
  </recv>

  <send>
    <![CDATA[
      ACK sip:1001@localhost:5060 SIP/2.0
      Via: SIP/2.0/[transport] [local_ip]:[local_port];branch=[branch]
      From: sipp <sip:sipp@[local_ip]:[local_port]>;tag=[call_number]
      To: sut <sip:1001@localhost:5060]>;tag=[peer_tag]
      Call-ID: [call_id]
      CSeq: 1 ACK
      Contact: <sip:sipp@[local_ip]:[local_port]>
      Max-Forwards: 70
      Content-Length: 0
    ]]>
  </send>

  <pause milliseconds="5000"/>

  <send retrans="500">
    <![CDATA[
      BYE sip:1001@localhost:5060 SIP/2.0
      Via: SIP/2.0/[transport] [local_ip]:[local_port];branch=[branch]
      From: sipp <sip:sipp@[local_ip]:[local_port]>;tag=[call_number]
      To: sut <sip:1001@localhost:5060]>;tag=[peer_tag]
      Call-ID: [call_id]
      CSeq: 2 BYE
      Contact: <sip:sipp@[local_ip]:[local_port]>
      Max-Forwards: 70
      Content-Length: 0
    ]]>
  </send>

  <recv response="200" rtd="true">
  </recv>
</scenario>
```

### uas_audio.xml (UAS with audio)

```xml
<?xml version="1.0" encoding="ISO-8859-1" ?>
<!DOCTYPE scenario SYSTEM "sipp.dtd">
<scenario name="UAS with Audio">
  <recv request="INVITE">
  </recv>

  <send>
    <![CDATA[
      SIP/2.0 100 Trying
      [last_Via:]
      [last_From:]
      [last_To:]
      [last_Call-ID:]
      [last_CSeq:]
      Contact: <sip:[local_ip]:[local_port];transport=[transport]>
      Content-Length: 0
    ]]>
  </send>

  <send>
    <![CDATA[
      SIP/2.0 180 Ringing
      [last_Via:]
      [last_From:]
      [last_To:];tag=[call_number]
      [last_Call-ID:]
      [last_CSeq:]
      Contact: <sip:[local_ip]:[local_port];transport=[transport]>
      Content-Length: 0
    ]]>
  </send>

  <send>
    <![CDATA[
      SIP/2.0 200 OK
      [last_Via:]
      [last_From:]
      [last_To:];tag=[call_number]
      [last_Call-ID:]
      [last_CSeq:]
      Contact: <sip:[local_ip]:[local_port];transport=[transport]>
      Content-Type: application/sdp
      Content-Length: [len]

      v=0
      o=user2 53655765 2353687637 IN IP[local_ip_type] [local_ip]
      s=-
      c=IN IP[local_ip_type] [local_ip]
      t=0 0
      m=audio [media_port] RTP/AVP 0 8 18
      a=rtpmap:0 PCMU/8000
      a=rtpmap:8 PCMA/8000
      a=rtpmap:18 G729/8000
      a=sendrecv
    ]]>
  </send>

  <recv request="ACK">
  </recv>

  <pause milliseconds="5000"/>

  <recv request="BYE">
  </recv>

  <send>
    <![CDATA[
      SIP/2.0 200 OK
      [last_Via:]
      [last_From:]
      [last_To:]
      [last_Call-ID:]
      [last_CSeq:]
      Contact: <sip:[local_ip]:[local_port];transport=[transport]>
      Content-Length: 0
    ]]>
  </send>
</scenario>
```

## Verify Media Flow

### Check RTPEngine Sessions

```bash
# List active sessions
docker-compose exec rtpengine rtpengine-ctl -t 127.0.0.1:9900 list

# Show statistics
docker-compose exec rtpengine rtpengine-ctl -t 127.0.0.1:9900 stats
```

### Check RTP Packets

```bash
# Capture RTP packets
docker-compose exec rtpengine tcpdump -i any -n udp port 10000-20000

# Or from host
tcpdump -i docker0 -n udp port 10000-20000
```

### Check Logs

```bash
# RTPEngine logs
docker-compose logs -f rtpengine

# Kamailio logs (should show RTPEngine commands)
docker-compose logs kamailio | grep rtpproxy

# FreeSWITCH logs
docker-compose logs freeswitch | grep RTP
```

## Expected Results

### Successful Call Flow

1. **SIP Signaling**: INVITE → 100 Trying → 180 Ringing → 200 OK → ACK
2. **RTPEngine Session**: Created when INVITE is processed
3. **Media Flow**: RTP packets flow through RTPEngine on ports 10000-20000
4. **NAT Handling**: RTPEngine rewrites SDP and handles NAT traversal
5. **Call Termination**: BYE → 200 OK, RTPEngine session deleted

### Verification Points

- RTPEngine shows active session: `rtpengine-ctl list`
- RTP packets visible in tcpdump
- No media issues reported in logs
- Call completes successfully

## Troubleshooting

### No RTPEngine Session Created

```bash
# Check Kamailio can reach RTPEngine
docker-compose exec kamailio telnet rtpengine 22222

# Check RTPEngine is listening
docker-compose exec rtpengine netstat -ulnp | grep 22222
```

### Media Not Flowing

```bash
# Check RTP ports are open
docker-compose exec rtpengine netstat -ulnp | grep 10000

# Check NAT rules
docker-compose exec rtpengine iptables -t nat -L

# Check RTPEngine statistics
docker-compose exec rtpengine rtpengine-ctl stats
```

### High Packet Loss

- Check network interface configuration
- Verify kernel parameters are set correctly
- Check for firewall rules blocking RTP ports
- Review RTPEngine statistics for errors
