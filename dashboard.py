import os, time

def get_detailed_stats():
    stats_file = '/opt/hopwhistle/stats.log'
    wins, machines, fails = 0, 0, 0
    
    if os.path.exists(stats_file):
        with open(stats_file, 'r') as f:
            lines = f.readlines()
            wins = lines.count("HUMAN_POSITIVE\n")
            machines = lines.count("MACHINE\n")
            fails = lines.count("NEGATIVE\n")
    return wins, machines, fails

print("--- 🚀 LIVE PERFORMANCE DASHBOARD 🚀 ---")
print("Tracking: Wins (Transfers) | Machines (Filtered) | Fails (Hangups)")

while True:
    wins, machines, fails = get_detailed_stats()
    total = wins + machines + fails
    win_rate = (wins / total * 100) if total > 0 else 0
    
    print("-" * 40)
    print(f"TIME: {time.strftime('%H:%M:%S')}")
    print(f"TOTAL PROCESSED: {total}")
    print(f"✅ TRANSFERS:    {wins}")
    print(f"🤖 MACHINES:     {machines}")
    print(f"❌ NEGATIVES:    {fails}")
    print(f"📈 WIN RATE:     {win_rate:.1f}%")
    
    time.sleep(10) # Update every 10 seconds so you can see it move!
