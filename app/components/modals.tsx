import { Button, Modal } from "@heroui/react"
import { type ComponentProps, type ReactNode } from "react"

interface Props
    extends Omit<ComponentProps<typeof Modal.Backdrop>, "children" | "title"> {
    title?: string
    children?: ReactNode
    /** Rendered after Close — the confirming action belongs here. */
    footer?: ReactNode
    closeLabel?: string
    size?: ComponentProps<typeof Modal.Container>["size"]
    placement?: ComponentProps<typeof Modal.Container>["placement"]
}

export const ConfirmModal = ({
    isOpen,
    onOpenChange,
    title,
    children,
    footer,
    closeLabel = "Close",
    size = "sm",
    placement = "center",
    variant = "blur",
    ...backdropProps
}: Props) => {
    return (
        <Modal.Backdrop
            isOpen={isOpen}
            onOpenChange={onOpenChange}
            variant={variant}
            {...backdropProps}
        >
            <Modal.Container placement={placement} size={size} scroll='inside'>
                <Modal.Dialog className='rounded-lg'>
                    <Modal.Header>
                        <Modal.Heading className='text-base capitalize'>
                            {title}
                        </Modal.Heading>
                    </Modal.Header>
                    <Modal.Body>{children}</Modal.Body>
                    <Modal.Footer>
                        <Button
                            size='sm'
                            variant='ghost'
                            className='rounded-lg'
                            onPress={() => onOpenChange?.(false)}
                        >
                            {closeLabel}
                        </Button>
                        {footer}
                    </Modal.Footer>
                </Modal.Dialog>
            </Modal.Container>
        </Modal.Backdrop>
    )
}
