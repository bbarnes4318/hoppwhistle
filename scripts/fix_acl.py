import xml.etree.ElementTree as ET

# Read the broken file
with open('/tmp/fs_conf/autoload_configs/acl.conf.xml', 'r') as f:
    lines = f.readlines()

# Find and remove the broken block (lines after </network-lists>)
output = []
skip = False
network_lists_closed = False
for line in lines:
    if '</network-lists>' in line and not network_lists_closed:
        # Insert the fixed BulkVS list BEFORE closing </network-lists>
        output.append('    <list name="bulkvs_sip_sources" default="deny">\n')
        output.append('      <node type="allow" cidr="162.249.171.0/24"/>\n')
        output.append('      <node type="allow" cidr="76.8.29.0/24"/>\n')
        output.append('      <node type="allow" cidr="142.171.206.0/24"/>\n')
        output.append('      <node type="allow" cidr="199.255.157.0/24"/>\n')
        output.append('      <node type="allow" cidr="69.12.88.0/24"/>\n')
        output.append('    </list>\n')
        output.append(line)  # </network-lists>
        network_lists_closed = True
        skip = True  # Skip the broken block that follows
        continue
    if skip:
        if '</list>' in line:
            skip = False  # End of broken block
            continue
        if '<list name=' in line or '<node type=' in line:
            continue  # Skip broken lines
    if not skip:
        output.append(line)

with open('/tmp/fs_conf/autoload_configs/acl.conf.xml', 'w') as f:
    f.writelines(output)

# Validate
try:
    ET.parse('/tmp/fs_conf/autoload_configs/acl.conf.xml')
    print('acl.conf.xml FIXED and VALID')
except ET.ParseError as e:
    print(f'acl.conf.xml STILL BROKEN: {e}')
