const logoDragType = 'application/x-webxreader-logo';
let draggingLogo = false;

export function startLogoDrag(transfer: DataTransfer) {
  transfer.setData(logoDragType, 'logo');
  transfer.effectAllowed = 'copy';
  draggingLogo = true;
}

export function endLogoDrag() {
  draggingLogo = false;
}

export function isLogoDrag(transfer: DataTransfer | null): transfer is DataTransfer {
  return draggingLogo && !!transfer?.types.includes(logoDragType);
}
