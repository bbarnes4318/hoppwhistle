const { PrismaClient } = require('@prisma/client');

async function test() {
  console.log('--- STARTING VERIFICATION TESTS ---');
  const prisma = new PrismaClient();

  let originalJimmyHash = null;
  let originalLeoHash = null;
  let jimmyId = '';
  let leoId = '';

  try {
    // 1. Fetch Users
    const jimmy = await prisma.user.findFirst({
      where: { email: 'afferioai@gmail.com' }
    });
    const leo = await prisma.user.findFirst({
      where: { email: 'strongsoundsource@gmail.com' }
    });

    if (!jimmy || !leo) {
      throw new Error(`Jimmy or Leo not found. Jimmy: ${!!jimmy}, Leo: ${!!leo}`);
    }

    jimmyId = jimmy.id;
    leoId = leo.id;
    originalJimmyHash = jimmy.passwordHash;
    originalLeoHash = leo.passwordHash;

    console.log(`Jimmy (Non-Admin) ID: ${jimmy.id}, TenantID: ${jimmy.tenantId}`);
    console.log(`Leo (Admin) ID: ${leo.id}, TenantID: ${leo.tenantId}`);

    // Reset any existing user assignments for phone numbers in the tenant to start fresh
    console.log('Resetting all phone number user assignments in tenant...');
    await prisma.phoneNumber.updateMany({
      where: { tenantId: jimmy.tenantId },
      data: { userId: null }
    });

    // Set temporary password hashes
    console.log('Setting temporary password hashes...');
    const testHash = '$2a$10$SipH4B734c.d0FXsdCa3neOQJ0AUUbsuYHqvOixg0HbJtpw8DOtK.'; // Pre-computed hash for Password123
    await prisma.user.update({ where: { id: jimmy.id }, data: { passwordHash: testHash } });
    await prisma.user.update({ where: { id: leo.id }, data: { passwordHash: testHash } });

    const apiBaseUrl = 'http://localhost:3001';

    // Helper function to call API
    const callApi = async (path, options = {}) => {
      const url = `${apiBaseUrl}${path}`;
      const headers = {
        ...options.headers
      };

      const fetchOptions = {
        ...options,
        headers
      };

      if (options.body) {
        if (typeof options.body === 'object') {
          fetchOptions.body = JSON.stringify(options.body);
          headers['Content-Type'] = 'application/json';
        } else {
          fetchOptions.body = options.body;
        }
      }

      const res = await fetch(url, fetchOptions);
      const isJson = res.headers.get('content-type')?.includes('application/json');
      const data = isJson ? await res.json() : await res.text();
      return {
        status: res.status,
        data
      };
    };

    // Log in Jimmy
    console.log('Logging in Jimmy...');
    const jimmyLoginRes = await callApi('/api/auth/login', {
      method: 'POST',
      body: { email: 'afferioai@gmail.com', password: 'Password123' }
    });
    if (jimmyLoginRes.status !== 200) {
      throw new Error(`Failed to log in Jimmy: ${JSON.stringify(jimmyLoginRes.data)}`);
    }
    const jimmyToken = jimmyLoginRes.data.token;

    // Log in Leo
    console.log('Logging in Leo...');
    const leoLoginRes = await callApi('/api/auth/login', {
      method: 'POST',
      body: { email: 'strongsoundsource@gmail.com', password: 'Password123' }
    });
    if (leoLoginRes.status !== 200) {
      throw new Error(`Failed to log in Leo: ${JSON.stringify(leoLoginRes.data)}`);
    }
    const leoToken = leoLoginRes.data.token;

    console.log('Tokens generated successfully!');

    // ----------------------------------------------------
    // TEST 1: Phone Numbers Isolation
    // ----------------------------------------------------
    console.log('\n--- TEST 1: Phone Numbers Isolation ---');

    // Jimmy (Non-Admin) list numbers (should see 0 since none assigned to him)
    const jimmyNumbersRes = await callApi('/api/v1/numbers', {
      method: 'GET',
      headers: { Authorization: `Bearer ${jimmyToken}` }
    });
    console.log('Jimmy numbers status:', jimmyNumbersRes.status);
    console.log('Jimmy numbers count:', jimmyNumbersRes.data.data?.length);
    if (jimmyNumbersRes.data.data?.length !== 0) {
      console.error('❌ FAIL: Non-admin user can see unassigned phone numbers');
    } else {
      console.log('✅ PASS: Non-admin user sees 0 phone numbers initially');
    }

    // Leo (Admin) list numbers (should see all numbers)
    const leoNumbersRes = await callApi('/api/v1/numbers', {
      method: 'GET',
      headers: { Authorization: `Bearer ${leoToken}` }
    });
    console.log('Leo numbers status:', leoNumbersRes.status);
    console.log('Leo numbers count:', leoNumbersRes.data.data?.length);
    if (leoNumbersRes.data.data?.length === 0) {
      console.error('❌ FAIL: Admin user sees 0 phone numbers');
    } else {
      console.log('✅ PASS: Admin user sees all phone numbers');
    }

    // ----------------------------------------------------
    // TEST 2: Outbound Dialing Gating (Blocked without number)
    // ----------------------------------------------------
    console.log('\n--- TEST 2: Outbound Dialing Gating ---');

    const dialRes1 = await callApi('/api/v1/agent/call/originate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${jimmyToken}` },
      body: { phoneNumber: '+15550192834' }
    });
    console.log('Dial status without assigned number:', dialRes1.status);
    console.log('Dial error response:', dialRes1.data);
    if (dialRes1.status === 400 && dialRes1.data.error?.code === 'NO_ASSIGNED_NUMBER') {
      console.log('✅ PASS: Dialing blocked for user without assigned numbers');
    } else {
      console.error('❌ FAIL: Dialing was not blocked correctly');
    }

    // ----------------------------------------------------
    // TEST 3: Assign number and dial again
    // ----------------------------------------------------
    console.log('\n--- TEST 3: Dialing after Assignment ---');

    // Find the first phone number
    const firstNum = await prisma.phoneNumber.findFirst({
      where: { tenantId: jimmy.tenantId }
    });
    if (!firstNum) {
      throw new Error('No phone number found in database to assign');
    }
    console.log(`Assigning number ${firstNum.number} to Jimmy...`);

    // Assign number to Jimmy via API
    const assignRes = await callApi(`/api/v1/numbers/${firstNum.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${leoToken}` },
      body: { userId: jimmy.id }
    });
    if (assignRes.status !== 200) {
      throw new Error(`Failed to assign number via API: ${JSON.stringify(assignRes.data)}`);
    }

    // Verify DidRoute was automatically created
    const lookupRes = await callApi(`/api/v1/freeswitch/lookup?did=${firstNum.number}`);
    console.log('DID lookup status after assignment:', lookupRes.status);
    console.log('DID lookup destination:', lookupRes.data.destination);
    if (lookupRes.status === 200 && lookupRes.data.destination === jimmy.id) {
      console.log('✅ PASS: DID route automatically created pointing to user ID');
    } else {
      console.error('❌ FAIL: DID routing was not created correctly');
    }

    // Unassign number to test cleanup
    const unassignRes = await callApi(`/api/v1/numbers/${firstNum.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${leoToken}` },
      body: { userId: null }
    });
    const lookupRes2 = await callApi(`/api/v1/freeswitch/lookup?did=${firstNum.number}`);
    console.log('DID lookup status after unassignment:', lookupRes2.status);
    if (lookupRes2.status === 404) {
      console.log('✅ PASS: DID route automatically cleaned up on unassignment');
    } else {
      console.error('❌ FAIL: DID route was not cleaned up');
    }

    // Re-assign to Jimmy for the remainder of the tests
    await callApi(`/api/v1/numbers/${firstNum.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${leoToken}` },
      body: { userId: jimmy.id }
    });

    // Jimmy (Non-Admin) list numbers again (should see 1 number)
    const jimmyNumbersRes2 = await callApi('/api/v1/numbers', {
      method: 'GET',
      headers: { Authorization: `Bearer ${jimmyToken}` }
    });
    console.log('Jimmy numbers count after assignment:', jimmyNumbersRes2.data.data?.length);
    console.log('Jimmy numbers:', jimmyNumbersRes2.data.data?.map((n) => n.number));
    if (jimmyNumbersRes2.data.data?.length === 1 && jimmyNumbersRes2.data.data[0].number === firstNum.number) {
      console.log('✅ PASS: Jimmy can now see his assigned phone number only');
    } else {
      console.error('❌ FAIL: Phone number assignment/isolation check failed');
    }

    // Try to dial out now
    const dialRes2 = await callApi('/api/v1/agent/call/originate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${jimmyToken}` },
      body: { phoneNumber: '+15550192834' }
    });
    console.log('Dial status with assigned number:', dialRes2.status);
    console.log('Dial response:', dialRes2.data);
    if (dialRes2.status === 201 && dialRes2.data.callerId === firstNum.number.replace(/\D/g, '')) {
      console.log('✅ PASS: Outbound call allowed with correct callerId:', dialRes2.data.callerId);
    } else {
      console.error('❌ FAIL: Outbound call failed or caller ID was incorrect');
    }

    // ----------------------------------------------------
    // TEST 4: Recording flow
    // ----------------------------------------------------
    console.log('\n--- TEST 4: Recording Flow ---');

    const callId = dialRes2.data.callId;

    console.log(`Simulating call answered for callId: ${callId}...`);
    const answerRes = await callApi(`/api/v1/agent/call/${callId}/answer`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jimmyToken}` },
      body: {}
    });
    console.log('Answer status:', answerRes.status);
    console.log('Answer data:', answerRes.data);

    // Verify recording status is RECORDING
    let callDb = await prisma.call.findUnique({ where: { id: callId } });
    console.log('Database call recording status after answer:', callDb?.recordingStatus);

    console.log('Simulating call hangup...');
    const hangupRes = await callApi(`/api/v1/agent/call/${callId}/hangup`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jimmyToken}` },
      body: {}
    });
    console.log('Hangup status:', hangupRes.status);

    callDb = await prisma.call.findUnique({ where: { id: callId } });
    console.log('Database call recording status after hangup:', callDb?.recordingStatus);

    // Mock upload recording using multipart
    console.log('Uploading mock recording file...');
    
    const boundary = '----WebKitFormBoundary7MA4YWxkTrZu0gW';
    
    const bodyParts = [];
    bodyParts.push(`--${boundary}\r\nContent-Disposition: form-data; name="callId"\r\n\r\n${callId}\r\n`);
    bodyParts.push(`--${boundary}\r\nContent-Disposition: form-data; name="format"\r\n\r\nwav\r\n`);
    bodyParts.push(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.wav"\r\nContent-Type: audio/wav\r\n\r\nRIFF\x24\x00\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00\x44\xac\x00\x00\x88\x58\x01\x00\x02\x00\x10\x00data\x00\x00\x00\x00\r\n`);
    bodyParts.push(`--${boundary}--\r\n`);
    
    const bodyBuffer = Buffer.concat(bodyParts.map(p => typeof p === 'string' ? Buffer.from(p, 'binary') : p));
    
    const uploadRes = await fetch(`${apiBaseUrl}/api/v1/recordings/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`
      },
      body: bodyBuffer
    });
    console.log('Upload status:', uploadRes.status);
    const uploadData = await uploadRes.json();
    console.log('Upload response:', uploadData);

    // Verify call row is updated to READY
    callDb = await prisma.call.findUnique({ where: { id: callId } });
    console.log('Final database call recording status:', callDb?.recordingStatus);
    console.log('Final database call recordingUrl:', callDb?.recordingUrl);
    console.log('Final database call primaryRecordingId:', callDb?.primaryRecordingId);

    if (callDb?.recordingStatus === 'READY' && callDb?.recordingUrl && callDb?.primaryRecordingId) {
      console.log('✅ PASS: Call recording flow completed and updated correctly');
    } else {
      console.error('❌ FAIL: Recording flow failed to update Call record to READY');
    }

    // ----------------------------------------------------
    // TEST 5: Call Logs Isolation
    // ----------------------------------------------------
    console.log('\n--- TEST 5: Call Logs Isolation ---');

    // Get call logs for Jimmy (should only see his call log)
    const jimmyCallsRes = await callApi('/api/v1/calls', {
      method: 'GET',
      headers: { Authorization: `Bearer ${jimmyToken}` }
    });
    console.log('Jimmy call logs status:', jimmyCallsRes.status);
    console.log('Jimmy call logs count:', jimmyCallsRes.data.data?.length);

    const last10Num = firstNum.number.replace(/\D/g, '').slice(-10);
    const allJimmyCallsOnly = jimmyCallsRes.data.data?.every((c) => {
      const matchUserId = c.createdById === jimmy.id;
      const matchPhone = (c.callerId && c.callerId.replace(/\D/g, '').slice(-10) === last10Num) ||
                          (c.toNumber && c.toNumber.replace(/\D/g, '').slice(-10) === last10Num) ||
                          (c.did && c.did.replace(/\D/g, '').slice(-10) === last10Num);
      return matchUserId || matchPhone;
    });

    if (jimmyCallsRes.data.data?.length > 0 && allJimmyCallsOnly) {
      console.log('✅ PASS: Non-admin user can only see their own call logs');
    } else {
      console.error('❌ FAIL: Call logs isolation check failed. Non-admin sees other calls or no calls.');
    }

    // Leo (Admin) list calls (should see all call logs, including Jimmy's and others)
    const leoCallsRes = await callApi('/api/v1/calls', {
      method: 'GET',
      headers: { Authorization: `Bearer ${leoToken}` }
    });
    console.log('Leo call logs count:', leoCallsRes.data.data?.length);
    if (leoCallsRes.data.data?.length >= jimmyCallsRes.data.data?.length) {
      console.log('✅ PASS: Admin user can see all call logs');
    } else {
      console.error('❌ FAIL: Admin call logs check failed');
    }

    // ----------------------------------------------------
    // CLEANUP
    // ----------------------------------------------------
    console.log('\n--- CLEANING UP ---');
    // Reset Jimmy's number assignment
    await prisma.phoneNumber.update({
      where: { id: firstNum.id },
      data: { userId: null }
    });
    // Delete the test call
    await prisma.recording.deleteMany({ where: { callId } });
    await prisma.call.delete({ where: { id: callId } });
    console.log('✅ Cleaned up database successfully');

  } catch (error) {
    console.error('❌ Error during verification:', error);
  } finally {
    // Restore original hashes
    console.log('Restoring original hashes...');
    if (originalJimmyHash !== null && jimmyId) {
      await prisma.user.update({ where: { id: jimmyId }, data: { passwordHash: originalJimmyHash } });
    }
    if (originalLeoHash !== null && leoId) {
      await prisma.user.update({ where: { id: leoId }, data: { passwordHash: originalLeoHash } });
    }
    await prisma.$disconnect();
    console.log('Verification script done.');
  }
}

test();
