// Browser-test adapter only: existing card fixtures now expose their equivalent
// direct per-process REST read. Never imported by the application.
export function assignedCardFixture(cards, machines, metadata = {}) {
  return cards.filter(c => c.machine_name && !c.current_process_off_station).map(c => ({
    id: c.current_process_id, tenant_id: c.tenant_id,
    process_order: metadata[c.current_process_id]?.process_order ?? 1,
    process_name: c.current_process_name, process_type: 'cnc',
    status: c.current_process_status, off_station_at: null, qty_completed: c.qty_completed,
    work_orders: { id: c.id, work_order_no: c.work_order_no, part_name: c.part_name,
      part_no: c.part_no, quantity: c.quantity, due_date: c.due_date, status: c.work_order_status },
    machines: machines.find(m => (m.machine_code || m.machine_name) === c.machine_name),
  }));
}
