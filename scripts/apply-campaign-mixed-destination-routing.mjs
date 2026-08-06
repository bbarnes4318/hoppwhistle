import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const routingPath = resolve(
  process.argv[2] || 'apps/api/src/services/routing.ts'
);
const didRoutesPath = resolve(
  process.argv[3] || 'apps/api/src/routes/did-routes.ts'
);

function patchRoutingService() {
  let source = readFileSync(routingPath, 'utf8');

  if (!source.includes('Selected campaign mixed destination ring/failover plan')) {
    const routingBlock = /      const softphoneOnly = eligibleEndpoints\.every\(endpoint =>[\s\S]*?      return \{\n        buyerId: primaryEndpoint\.buyerId,\n        endpoint: failoverDestinationString,\n        targetId: primaryEndpoint\.endpointId,\n        callerState: this\.resolveCallerState\(callData\),\n      \};/;

    const replacement = `      // Build one sequential failover step per priority. Every eligible internal
      // Hopwhistle extension at that priority rings in parallel. When external
      // buyers/cell phones share the priority, choose exactly one external leg by
      // weight and ring it alongside the internal users. Pure external campaigns
      // therefore retain their original weighted single-buyer behavior.
      const pickWeighted = (group: EligibleEndpoint[]): EligibleEndpoint => {
        let totalWeight = 0;
        for (const endpoint of group) {
          totalWeight += Math.max(1, endpoint.weight);
        }

        const randomValue = Math.random() * totalWeight;
        let currentSum = 0;
        let selectedEndpoint = group[0];
        for (const endpoint of group) {
          currentSum += Math.max(1, endpoint.weight);
          if (randomValue <= currentSum) {
            selectedEndpoint = endpoint;
            break;
          }
        }
        return selectedEndpoint;
      };

      // Ring EVERY external buyer in a step instead of one chosen by weight.
      //
      // Opt-in per campaign (\`metadata.ringAllExternalBuyers\`), because the
      // weighted pick is what distributes calls across competing buyers
      // everywhere else — switching it on globally would blast every call to
      // every buyer on the campaign. Clearing the flag is the rollback.
      //
      // Only read when a step actually holds more than one external, so the
      // usual routing decision does not gain a query.
      const hasStepWithMultipleExternals = sortedPriorities.some(
        priority =>
          priorityGroups
            .get(priority)!
            .filter(endpoint => !isInternalAgentDestination(endpoint.destination)).length > 1
      );

      let ringAllExternalBuyers = false;
      if (hasStepWithMultipleExternals) {
        try {
          const campaign = await this.prisma.campaign.findFirst({
            where: { id: campaignId, tenantId },
            select: { metadata: true },
          });
          const meta =
            campaign?.metadata &&
            typeof campaign.metadata === 'object' &&
            !Array.isArray(campaign.metadata)
              ? (campaign.metadata as Record<string, unknown>)
              : {};
          ringAllExternalBuyers = meta.ringAllExternalBuyers === true;
        } catch (metaErr) {
          // Fail closed, to the existing behaviour.
          logger.warn({
            msg: 'Agent-routing: could not read ringAllExternalBuyers (using weighted pick)',
            campaignId,
            error: (metaErr as Error).message,
          });
        }
      }

      const ringSteps: string[] = [];
      const selectedEndpoints: EligibleEndpoint[] = [];

      for (const priority of sortedPriorities) {
        const group = priorityGroups.get(priority)!;
        const internalEndpoints = group.filter(endpoint =>
          isInternalAgentDestination(endpoint.destination)
        );
        const externalEndpoints = group.filter(
          endpoint => !isInternalAgentDestination(endpoint.destination)
        );

        const stepEndpoints: EligibleEndpoint[] = [...internalEndpoints];
        if (externalEndpoints.length > 0) {
          if (ringAllExternalBuyers) {
            stepEndpoints.push(...externalEndpoints);
          } else {
            stepEndpoints.push(pickWeighted(externalEndpoints));
          }
        }

        const seen = new Set<string>();
        const destinations = stepEndpoints
          .map(endpoint => endpoint.destination.trim())
          .filter(destination => {
            if (!destination || seen.has(destination)) return false;
            seen.add(destination);
            return true;
          });

        if (destinations.length > 0) {
          ringSteps.push(destinations.join(','));
          selectedEndpoints.push(...stepEndpoints);
        }
      }

      // Agent-assigned external DIDs are translated to their registered
      // Hopwhistle extension. Only append those DIDs as a final PSTN fallback
      // when the campaign explicitly opts in.
      const externalFallbacks = eligibleEndpoints
        .map(endpoint => endpoint.externalFallbackDestination?.trim())
        .filter((destination): destination is string => !!destination);

      if (externalFallbacks.length > 0) {
        try {
          const campaign = await this.prisma.campaign.findFirst({
            where: { id: campaignId, tenantId },
            select: { metadata: true },
          });
          const meta =
            campaign?.metadata &&
            typeof campaign.metadata === 'object' &&
            !Array.isArray(campaign.metadata)
              ? (campaign.metadata as Record<string, unknown>)
              : {};

          if (meta.allowAgentDidExternalFallback === true) {
            ringSteps.push([...new Set(externalFallbacks)].join(','));
            logger.info({
              msg: 'Agent-routing: External DID fallback step enabled by campaign metadata',
              campaignId,
              fallbackCount: new Set(externalFallbacks).size,
            });
          }
        } catch (metaErr) {
          logger.warn({
            msg: 'Agent-routing: Could not evaluate external-fallback setting (skipping fallback)',
            campaignId,
            error: (metaErr as Error).message,
          });
        }
      }

      if (ringSteps.length === 0) {
        return null;
      }

      const primaryEndpoint = selectedEndpoints[0] || eligibleEndpoints[0];
      const routePlan = ringSteps.join('|');

      logger.info({
        msg: 'Selected campaign mixed destination ring/failover plan',
        campaignId,
        buyerId: primaryEndpoint.buyerId,
        buyerName: primaryEndpoint.buyerName,
        endpointId: primaryEndpoint.endpointId,
        destination: routePlan,
        eligibleCount: eligibleEndpoints.length,
        prioritySteps: ringSteps.length,
        callerState: this.resolveCallerState(callData),
      });

      return {
        buyerId: primaryEndpoint.buyerId,
        endpoint: routePlan,
        targetId: primaryEndpoint.endpointId,
        callerState: this.resolveCallerState(callData),
      };`;

    if (!routingBlock.test(source)) {
      throw new Error('Unable to patch routing.ts: expected selectBestBuyer block not found');
    }
    source = source.replace(routingBlock, replacement);
  }

  for (const marker of [
    'Selected campaign mixed destination ring/failover plan',
    'stepEndpoints.push(pickWeighted(externalEndpoints))',
    "ringSteps.push(destinations.join(','))",
  ]) {
    if (!source.includes(marker)) {
      throw new Error(`routing.ts verification failed: ${marker}`);
    }
  }

  writeFileSync(routingPath, source);
  console.log(`Permanent mixed campaign routing applied: ${routingPath}`);
}

function patchDidRouteFallback() {
  let source = readFileSync(didRoutesPath, 'utf8');

  if (!source.includes('Dynamic route returned no eligible destinations; refusing to bypass routing filters')) {
    const unsafeFallback = /        \} else \{\n          const allCampaignBuyers = await prisma\.campaignBuyer\.findMany\([\s\S]*?        \}\n      \} catch \(routingErr\)/;
    const replacement = `        } else {
          // Do not ring every configured destination after routing rejected all
          // buyers for geo, status, or concurrency. That old fallback bypassed
          // the campaign's safety rules and could send a call to a busy or
          // ineligible buyer. Return an empty destination so FreeSWITCH plays the
          // controlled no-agent response instead.
          destination = '';
          buyerId = null;
          targetId = null;
          console.log(
            \`[FS-LOOKUP] Dynamic route returned no eligible destinations; refusing to bypass routing filters for campaign=\${route.campaignId} caller=\${caller}\`
          );
        }
      } catch (routingErr)`;

    if (!unsafeFallback.test(source)) {
      throw new Error('Unable to patch did-routes.ts: unsafe all-buyers fallback not found');
    }
    source = source.replace(unsafeFallback, replacement);
  }

  if (!source.includes('refusing to bypass routing filters')) {
    throw new Error('did-routes.ts verification failed');
  }

  writeFileSync(didRoutesPath, source);
  console.log(`Campaign route filter bypass removed: ${didRoutesPath}`);
}

patchRoutingService();
patchDidRouteFallback();
