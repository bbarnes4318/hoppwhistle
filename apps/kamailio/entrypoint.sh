#!/bin/bash
# Kamailio entrypoint script

set -e

# Ensure dispatcher.list exists
if [ ! -f /etc/kamailio/dispatcher.list ]; then
    echo "Creating default dispatcher.list..."
    cat > /etc/kamailio/dispatcher.list <<EOF
# FreeSWITCH Dispatcher List
1 sip:freeswitch:5080 0 0 "" "FreeSWITCH Node 1"
EOF
fi

# Start Kamailio (dispatcher.list will be loaded automatically)
exec kamailio -f /etc/kamailio/kamailio.cfg -DD -E

