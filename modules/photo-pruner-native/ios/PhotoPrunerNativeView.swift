import ExpoModulesCore
import UIKit

class PhotoPrunerNativeView: ExpoView {
  let onCommand = EventDispatcher()
  var enabled = true {
    didSet {
      if enabled { claimFocus() } else { resignFirstResponder() }
    }
  }
  override var canBecomeFirstResponder: Bool { enabled }
  override func didMoveToWindow() {
    super.didMoveToWindow()
    claimFocus()
  }
  private func claimFocus() {
    DispatchQueue.main.async { [weak self] in
      guard let self = self, self.enabled, self.window != nil else { return }
      self.becomeFirstResponder()
    }
  }
  override var keyCommands: [UIKeyCommand]? {
    guard enabled else { return [] }
    return ["y", "n", "u", "0", "1", "2", "3", "4", "5", UIKeyCommand.inputLeftArrow, UIKeyCommand.inputRightArrow, UIKeyCommand.inputUpArrow, UIKeyCommand.inputDownArrow].map { input in
      let command = UIKeyCommand(input: input, modifierFlags: [], action: #selector(handleKey(_:)))
      command.wantsPriorityOverSystemBehavior = true
      return command
    }
  }
  @objc private func handleKey(_ command: UIKeyCommand) {
    guard enabled, let input = command.input else { return }
    let arrows = [UIKeyCommand.inputLeftArrow: "ArrowLeft", UIKeyCommand.inputRightArrow: "ArrowRight", UIKeyCommand.inputUpArrow: "ArrowUp", UIKeyCommand.inputDownArrow: "ArrowDown"]
    onCommand(["key": arrows[input] ?? input])
  }
}
